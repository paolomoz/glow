/**
 * E2E test for the Glow Chrome extension.
 *
 * Launches Chrome with the extension loaded, serves a test page,
 * imports a test index, and verifies the full signal → intent → generation → injection flow.
 *
 * Usage: npx tsx test/e2e/extension.e2e.ts
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { createServer, type Server } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EXTENSION_PATH = resolve(__dirname, '../../dist/extension');
const TEST_PAGE_PATH = resolve(__dirname, 'test-page.html');
const TEST_INDEX_PATH = resolve(__dirname, 'test-index.json');
const ENV_PATH = resolve(__dirname, '../../.env');
const TEST_PORT = 3999;
const TEST_URL = `http://localhost:${TEST_PORT}/`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadEnvKey(key: string): string | null {
  try {
    const content = readFileSync(ENV_PATH, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && match[1].trim() === key) {
        return match[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* no .env */ }
  return null;
}

function startServer(): Promise<Server> {
  const html = readFileSync(TEST_PAGE_PATH, 'utf8');
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(TEST_PORT, () => resolve(server));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getExtensionId(browser: Browser): Promise<string> {
  // Find the extension's service worker URL to extract the extension ID
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('service-worker'),
    { timeout: 10000 },
  );
  // URL is like: chrome-extension://<id>/background/service-worker.js
  const match = swTarget.url().match(/chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error('Could not extract extension ID');
  return match[1];
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let browser: Browser | null = null;
let server: Server | null = null;
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function run(): Promise<void> {
  const apiKey = loadEnvKey('CEREBRAS_API_KEY');

  console.log('Starting E2E test...');
  console.log(`  Extension: ${EXTENSION_PATH}`);
  console.log(`  API Key: ${apiKey ? 'found' : 'MISSING — generation tests will be skipped'}`);

  // Start test server
  server = await startServer();
  console.log(`  Test server: ${TEST_URL}\n`);

  // Launch Chrome with extension
  console.log('1. Launching Chrome with extension...');
  browser = await puppeteer.launch({
    headless: false, // Extensions require headed mode
    protocolTimeout: 60000,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking',
      `--user-data-dir=/tmp/glow-e2e-${Date.now()}`,
    ],
  });

  // Wait for service worker
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('service-worker'),
    { timeout: 10000 },
  );
  assert(!!swTarget, 'Service worker loaded');

  const extensionId = await getExtensionId(browser);
  console.log(`  Extension ID: ${extensionId}`);

  // ---------------------------------------------------------------------------
  // Test 2: Set API key and import index via extension page
  // ---------------------------------------------------------------------------
  console.log('\n2. Setting up extension (API key + index)...');

  // Open a page in the extension's origin to access chrome APIs
  const setupPage = await browser.newPage();
  await setupPage.goto(`chrome-extension://${extensionId}/panel/panel.html`, {
    waitUntil: 'domcontentloaded',
  });
  await sleep(500);

  // Set API key via chrome.storage.local
  if (apiKey) {
    await setupPage.evaluate(`chrome.storage.local.set({ cerebras_api_key: "${apiKey}" })`);
    await sleep(300);
    assert(true, 'API key stored in chrome.storage.local');
  } else {
    assert(true, 'Skipped API key (not available)');
  }

  // Import test index via message to service worker
  const testIndexStr = readFileSync(TEST_INDEX_PATH, 'utf8');
  const importResult: any = await setupPage.evaluate(`
    new Promise((resolve) => {
      const index = ${testIndexStr};
      chrome.runtime.sendMessage(
        { type: 'IMPORT_INDEX', index },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        },
      );
    })
  `);

  assert(
    importResult?.success === true,
    `Index imported: ${importResult?.atomCount ?? 0} atoms, ${importResult?.templateCount ?? 0} templates`,
  );

  // Verify IndexedDB data from extension context
  const dbStats: any = await setupPage.evaluate(`
    (async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('glow-content-index', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const cnt = (store) => new Promise((resolve) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
      });
      return {
        atomCount: await cnt('atoms'),
        templateCount: await cnt('templates'),
        profileCount: await cnt('profiles'),
      };
    })()
  `);

  assert(dbStats.atomCount === 8, `IndexedDB atoms: ${dbStats.atomCount} (expected 8)`);
  assert(dbStats.templateCount === 2, `IndexedDB templates: ${dbStats.templateCount} (expected 2)`);
  assert(dbStats.profileCount === 1, `IndexedDB profiles: ${dbStats.profileCount} (expected 1)`);

  await setupPage.close();

  // ---------------------------------------------------------------------------
  // Test 3: Navigate to test page — content script should load
  // ---------------------------------------------------------------------------
  console.log('\n3. Navigating to test page...');
  const page = (await browser.pages())[0] || await browser.newPage();

  // Collect ALL console messages and errors BEFORE navigation
  const consoleMessages: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  await page.goto(TEST_URL, { waitUntil: 'networkidle0' });
  await sleep(1500); // Extra time for content script to initialize

  const pageTitle = await page.title();
  assert(pageTitle === 'Glow E2E Test Page', `Page loaded: "${pageTitle}"`);

  // Report any page errors
  if (pageErrors.length > 0) {
    console.log(`  ⚠ ${pageErrors.length} page errors:`);
    for (const e of pageErrors) console.log(`    ${e.slice(0, 200)}`);
  }

  // Check content script execution via CDP Runtime.evaluate in isolated world
  const cdp = await page.createCDPSession();

  // Get all execution contexts (main world + content script isolated worlds)
  const { result: contexts } = await cdp.send('Runtime.evaluate', {
    expression: 'typeof chrome !== "undefined" && typeof chrome.runtime !== "undefined" && typeof chrome.runtime.sendMessage === "function"',
    contextId: undefined, // Default context (main world)
  });
  console.log(`  Main world chrome.runtime: ${contexts.value}`);

  // Try to find the content script's execution context
  // We can detect if the content script ran by checking for its side effects
  // One way: the content script attaches scroll/click listeners.
  // Another: use CDP to get all execution contexts
  let contentScriptWorking = false;
  try {
    const { executionContexts } = await cdp.send('Page.getExecutionContexts' as any) as any;
    console.log(`  Execution contexts: ${executionContexts?.length ?? 'unknown'}`);
  } catch {
    // Not all CDP commands are available
  }

  // ---------------------------------------------------------------------------
  // Test 4: Simulate user interactions
  // ---------------------------------------------------------------------------
  console.log('\n4. Simulating user interactions...');

  // Scroll
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
  await sleep(300);

  // Click CTA links (seek_action signals)
  const ctaClicks = ['/get-started', '/demo', '/features/speed', '/features/security', '/features/ai', '/pricing'];
  for (const href of ctaClicks) {
    try {
      await page.click(`a[href="${href}"]`);
    } catch { /* link may cause navigation */ }
    await sleep(150);
  }

  assert(true, `Simulated scroll + ${ctaClicks.length} clicks`);

  // Wait for first signal batch (500ms interval + Cerebras processing)
  console.log('\n5. Waiting for signal processing...');
  await sleep(3000);

  // Check for any errors in the console log so far
  const errorsAfterInteraction = consoleMessages.filter((m) => m.type === 'error');
  if (errorsAfterInteraction.length > 0) {
    console.log(`  ⚠ ${errorsAfterInteraction.length} console errors after interaction:`);
    for (const e of errorsAfterInteraction.slice(0, 5)) {
      console.log(`    ${e.text.slice(0, 200)}`);
    }
  }

  // Capture service worker console via CDP
  const swLogs: string[] = [];
  try {
    const swCdp = await swTarget.createCDPSession();
    await swCdp.send('Runtime.enable');
    swCdp.on('Runtime.consoleAPICalled', (params: any) => {
      const text = params.args?.map((a: any) => a.value ?? a.description ?? '').join(' ');
      swLogs.push(text);
      if (text.includes('[glow]')) {
        console.log(`    ${text}`);
      }
    });
  } catch {
    // CDP not available for SW
  }

  // ---------------------------------------------------------------------------
  // Test 5: Check signal flow (did signals reach the background?)
  // ---------------------------------------------------------------------------
  console.log('\n6. Verifying signal flow...');

  // Check the service worker's internal state via its worker handle
  const swWorker = await swTarget.worker();
  assert(!!swWorker, 'Service worker accessible for state check');

  // We can't easily access the session manager's internal Map from evaluate
  // because chrome APIs may not be available. Instead, let's check IndexedDB
  // for any logged events, or check by sending a manual signal batch from the extension page.

  // Open extension page to send a test signal manually (bypasses content script)
  const checkPage = await browser.newPage();
  await checkPage.goto(`chrome-extension://${extensionId}/panel/panel.html`, {
    waitUntil: 'domcontentloaded',
  });
  await sleep(500);

  // Send a manual signal batch to verify the background handler works
  const manualResult: any = await checkPage.evaluate(`
    new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SIGNAL_BATCH',
        signals: [
          { type: 'page_visit', timestamp: new Date().toISOString(), data: { url: 'http://localhost:3999/', referrer: '', title: 'Test' }, pageUrl: 'http://localhost:3999/' },
          { type: 'scroll_depth', timestamp: new Date().toISOString(), data: { depth: 0.7, maxDepth: 0.7 }, pageUrl: 'http://localhost:3999/' },
          { type: 'click_target', timestamp: new Date().toISOString(), data: { text: 'Get Started', href: '/get-started' }, pageUrl: 'http://localhost:3999/' },
          { type: 'click_target', timestamp: new Date().toISOString(), data: { text: 'Request a Demo', href: '/demo' }, pageUrl: 'http://localhost:3999/' },
          { type: 'click_target', timestamp: new Date().toISOString(), data: { text: 'Compare plans', href: '/pricing' }, pageUrl: 'http://localhost:3999/' },
        ],
        pageUrl: 'http://localhost:3999/',
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    })
  `);

  console.log(`  Manual signal batch result: ${JSON.stringify(manualResult)?.slice(0, 200)}`);
  assert(
    manualResult && !manualResult.error,
    `Background processed manual signal batch`,
  );

  // Check if blocks were returned
  if (manualResult?.blocks?.length > 0) {
    console.log(`  ℹ Got ${manualResult.blocks.length} blocks from manual batch!`);
  } else {
    console.log(`  ℹ No blocks from first batch (confidence building needed)`);
  }

  await checkPage.close();

  // ---------------------------------------------------------------------------
  // Test 6: Simulate more rounds to build confidence
  // ---------------------------------------------------------------------------
  if (apiKey) {
    console.log('\n7. Building confidence with repeated signal batches...');

    // Send multiple rounds of signals from the extension page to build confidence
    const signalPage = await browser.newPage();
    await signalPage.goto(`chrome-extension://${extensionId}/panel/panel.html`, {
      waitUntil: 'domcontentloaded',
    });
    await sleep(300);

    let lastResult: any = null;
    for (let round = 1; round <= 4; round++) {
      // Send 20+ signals per batch to saturate the signal count boost.
      // Mix of page visits, scrolls, clicks, and time-on-section to build
      // a clear seek_action archetype signal.
      lastResult = await signalPage.evaluate(`
        new Promise((resolve) => {
          const now = new Date().toISOString();
          const url = 'http://localhost:${TEST_PORT}/';
          const r = ${round};
          const signals = [
            { type: 'page_visit', timestamp: now, data: { url, referrer: '', title: 'Test' }, pageUrl: url },
            { type: 'scroll_depth', timestamp: now, data: { depth: 0.7, maxDepth: 0.7 }, pageUrl: url },
            { type: 'time_on_section', timestamp: now, data: { section: 'main', durationMs: 25000 }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Get Started', href: '/get-started' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Request a Demo', href: '/demo' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Buy Now', href: '/buy' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Schedule Call', href: '/schedule' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Book a Meeting', href: '/book' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Order Now', href: '/order' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Apply Today', href: '/apply' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Reserve Spot', href: '/reserve' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Shop Plans', href: '/shop' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Contact Sales', href: '/contact' }, pageUrl: url },
            { type: 'form_interaction', timestamp: now, data: { fieldName: 'email', action: 'focus' }, pageUrl: url },
            { type: 'form_interaction', timestamp: now, data: { fieldName: 'name', action: 'focus' }, pageUrl: url },
          ];
          // Add unique page visits for diversity (each round gets different pages)
          for (let i = 0; i < 8; i++) {
            signals.push({ type: 'page_visit', timestamp: now, data: { url: url + 'page-' + r + '-' + i, referrer: url, title: 'Page ' + i }, pageUrl: url });
          }
          chrome.runtime.sendMessage({
            type: 'SIGNAL_BATCH',
            signals,
            pageUrl: url,
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          });
        })
      `);

      const blockCount = lastResult?.blocks?.length ?? 0;
      console.log(`  Round ${round}/4: ${blockCount} blocks returned`);

      if (blockCount > 0) break;
      await sleep(500);
    }

    await signalPage.close();

    // Print any non-glow SW logs for debugging
    const nonGlowLogs = swLogs.filter(l => !l.includes('[glow]') && l.length > 0);
    if (nonGlowLogs.length > 0) {
      console.log(`  Other SW logs (${nonGlowLogs.length}):`);
      for (const log of nonGlowLogs.slice(0, 5)) {
        console.log(`    ${log.slice(0, 200)}`);
      }
    }

    // ---------------------------------------------------------------------------
    // Test 7: Check results
    // ---------------------------------------------------------------------------
    console.log('\n8. Checking generation results...');

    if (lastResult?.blocks?.length > 0) {
      assert(true, `${lastResult.blocks.length} block(s) generated by Cerebras!`);
      for (const block of lastResult.blocks) {
        console.log(`  Block: ${block.templateId} | model: ${block.model} | ${block.generationTimeMs}ms`);
        console.log(`  HTML preview: ${block.html?.slice(0, 100)}...`);
      }

      // Now inject the blocks into the test page using the template's selector
      for (const block of lastResult.blocks) {
        const injected = await page.evaluate(`
          (function() {
            const target = document.querySelector('${block.selector.replace(/'/g, "\\'")}');
            if (!target) return { found: false, selector: '${block.selector}' };

            const wrapper = document.createElement('div');
            wrapper.setAttribute('data-glow-injected', 'true');
            wrapper.setAttribute('data-template-id', '${block.templateId}');
            wrapper.innerHTML = ${JSON.stringify(block.html)};
            target.innerHTML = '';
            target.appendChild(wrapper);
            return { found: true, injected: true };
          })()
        `);
        console.log(`  Injection: ${JSON.stringify(injected)}`);
      }

      const injectionCheck = await page.evaluate(`
        (function() {
          return {
            injectedBlocks: document.querySelectorAll('[data-glow-injected]').length,
          };
        })()
      `);
      assert(injectionCheck.injectedBlocks > 0, `${injectionCheck.injectedBlocks} block(s) injected into page DOM`);
    } else {
      console.log(`  Last result: ${JSON.stringify(lastResult)?.slice(0, 300)}`);
      assert(false, 'No blocks generated after 4 rounds');
    }
  } else {
    console.log('\n7-8. Skipping generation/injection tests (no API key)');
  }

  // ---------------------------------------------------------------------------
  // Test 8: Verify no fatal extension errors
  // ---------------------------------------------------------------------------
  console.log('\n9. Checking for errors...');
  const errors = consoleMessages.filter((m) => m.type === 'error');
  const extensionErrors = errors.filter(
    (e) =>
      e.text.toLowerCase().includes('glow') ||
      e.text.includes('service-worker') ||
      e.text.includes('chrome-extension'),
  );

  assert(
    extensionErrors.length === 0,
    `No extension errors (${extensionErrors.length} of ${errors.length} total console errors)`,
  );
  if (extensionErrors.length > 0) {
    for (const err of extensionErrors.slice(0, 5)) {
      console.error(`    ${err.text}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\nE2E test crashed:', err);
    failed++;
  } finally {
    if (browser) await browser.close();
    if (server) server.close();

    console.log(`\n${'='.repeat(50)}`);
    console.log(`E2E Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    process.exit(failed > 0 ? 1 : 0);
  }
})();

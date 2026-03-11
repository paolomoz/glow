/**
 * Quick E2E test against bmwusa.com with the real index.
 * Usage: npx tsx test/e2e/bmw-test.ts
 */

import puppeteer, { type Browser } from 'puppeteer';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const EXTENSION_PATH = resolve(__dirname, '../../dist/extension');
const BMW_INDEX_PATH = resolve(__dirname, '../../data/www.bmwusa.com-demo.json');
const ENV_PATH = resolve(__dirname, '../../.env');

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(): Promise<void> {
  const apiKey = loadEnvKey('CEREBRAS_API_KEY');
  console.log(`API Key: ${apiKey ? 'found' : 'MISSING'}`);

  const browser = await puppeteer.launch({
    headless: false,
    protocolTimeout: 60000,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      `--user-data-dir=/tmp/glow-bmw-${Date.now()}`,
    ],
  });

  try {
    // Wait for service worker
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes('service-worker'),
      { timeout: 10000 },
    );
    console.log('✓ Service worker loaded');

    // Capture SW console
    const swCdp = await swTarget.createCDPSession();
    await swCdp.send('Runtime.enable');
    swCdp.on('Runtime.consoleAPICalled', (params: any) => {
      const text = params.args?.map((a: any) => a.value ?? a.description ?? '').join(' ');
      if (text.includes('[glow]')) {
        console.log(`  SW: ${text}`);
      }
    });

    // Get extension ID
    const match = swTarget.url().match(/chrome-extension:\/\/([^/]+)/);
    const extensionId = match![1];
    console.log(`Extension ID: ${extensionId}`);

    // Step 1: Import index
    console.log('\n--- Step 1: Import BMW index ---');
    const setupPage = await browser.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/panel/panel.html`, {
      waitUntil: 'domcontentloaded',
    });
    await sleep(500);

    // Set API key
    if (apiKey) {
      await setupPage.evaluate(`chrome.storage.local.set({ cerebras_api_key: "${apiKey}" })`);
      console.log('✓ API key set');
    }

    // Import index
    const indexStr = readFileSync(BMW_INDEX_PATH, 'utf8');
    const importResult: any = await setupPage.evaluate(`
      new Promise((resolve) => {
        const index = ${indexStr};
        chrome.runtime.sendMessage(
          { type: 'IMPORT_INDEX', index },
          (response) => resolve(response),
        );
      })
    `);
    console.log(`Import: ${JSON.stringify(importResult)}`);

    // Verify IndexedDB
    const dbStats: any = await setupPage.evaluate(`
      (async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('glow-content-index', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const getAll = (store) => new Promise((resolve) => {
          const tx = db.transaction(store, 'readonly');
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
        });
        const templates = await getAll('templates');
        const atoms = await getAll('atoms');
        const profiles = await getAll('profiles');
        return {
          atomCount: atoms.length,
          templateCount: templates.length,
          profileCount: profiles.length,
          templateIds: templates.map(t => t.id),
          templateSelectors: templates.map(t => t.selector),
          templatePositions: templates.map(t => t.position),
          templateSiteIds: templates.map(t => t.siteId),
        };
      })()
    `);
    console.log(`IndexedDB: ${JSON.stringify(dbStats, null, 2)}`);

    // Step 2: Send signals as if from bmwusa.com
    console.log('\n--- Step 2: Send BMW signals ---');
    const signalResult: any = await setupPage.evaluate(`
      new Promise((resolve) => {
        const now = new Date().toISOString();
        const url = 'https://www.bmwusa.com/';
        chrome.runtime.sendMessage({
          type: 'SIGNAL_BATCH',
          signals: [
            { type: 'page_visit', timestamp: now, data: { url, referrer: '', title: 'BMW USA' }, pageUrl: url },
            { type: 'scroll_depth', timestamp: now, data: { depth: 0.8, maxDepth: 0.8 }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Build Your Own', href: '/build-your-own.html', source: 'chatgpt' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'See all offers', href: '/offers' }, pageUrl: url },
            { type: 'click_target', timestamp: now, data: { text: 'Get Started', href: '/get-started' }, pageUrl: url },
            { type: 'time_on_section', timestamp: now, data: { sectionId: 'hero', durationMs: 30000 }, pageUrl: url },
            { type: 'page_visit', timestamp: now, data: { url: url + 'vehicles/', referrer: url, title: 'Vehicles' }, pageUrl: url },
            { type: 'page_visit', timestamp: now, data: { url: url + 'build-your-own.html', referrer: url, title: 'Build' }, pageUrl: url },
            { type: 'page_visit', timestamp: now, data: { url: url + 'inventory.html', referrer: url, title: 'Inventory' }, pageUrl: url },
            { type: 'page_visit', timestamp: now, data: { url: url + 'offers/', referrer: url, title: 'Offers' }, pageUrl: url },
          ],
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

    await sleep(5000); // Wait for Cerebras

    console.log(`\nSignal result: ${JSON.stringify(signalResult)?.slice(0, 500)}`);

    if (signalResult?.blocks?.length > 0) {
      console.log(`\n✓ ${signalResult.blocks.length} blocks generated!`);
      for (const block of signalResult.blocks) {
        console.log(`  Template: ${block.templateId}`);
        console.log(`  Selector: ${block.selector}`);
        console.log(`  Model: ${block.model} (${block.generationTimeMs}ms)`);
        console.log(`  Confidence: ${block.confidence}`);
        console.log(`  HTML: ${block.html?.slice(0, 200)}...`);
      }
    } else {
      console.log('\n✗ No blocks generated');
    }

    // Step 3: Navigate to bmwusa.com and check content script + selectors
    console.log('\n--- Step 3: Navigate to bmwusa.com ---');
    const page = (await browser.pages())[0] || await browser.newPage();

    // Capture page console
    const pageErrors: string[] = [];
    const pageLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      pageLogs.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') pageErrors.push(text);
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('https://www.bmwusa.com/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✓ Page loaded');
    await sleep(3000);

    // Check if content script is active
    console.log('\n--- Step 4: Check content script ---');

    // Page errors
    if (pageErrors.length > 0) {
      console.log(`Page errors (${pageErrors.length}):`);
      for (const e of pageErrors.slice(0, 10)) {
        console.log(`  ERR: ${e.slice(0, 200)}`);
      }
    }

    // Check for glow-related logs
    const glowLogs = pageLogs.filter(l => l.toLowerCase().includes('glow') || l.includes('content-script'));
    if (glowLogs.length > 0) {
      console.log(`Glow page logs:`);
      for (const l of glowLogs) console.log(`  ${l.slice(0, 200)}`);
    } else {
      console.log('No glow-related page logs');
    }

    // Simulate interaction
    console.log('\n--- Step 5: Simulate interactions ---');
    await page.evaluate(() => window.scrollTo(0, 500));
    await sleep(500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    await sleep(500);

    // Move mouse over hero
    await page.mouse.move(400, 300);
    await sleep(600);
    await page.mouse.move(400, 400);
    await sleep(600);

    // Click somewhere
    try {
      await page.click('a[href*="build-your-own"]');
    } catch { /* may navigate */ }
    await sleep(1000);

    // Wait for signal batch (500ms interval)
    await sleep(3000);

    // Check selectors
    const selectorCheck: any = await page.evaluate(`
      (function() {
        return {
          hero: !!document.querySelector('#container-6789079d29'),
          main: !!document.querySelector('main#main'),
          compare: !!document.querySelector('#container-e2b32be718'),
          glowInjected: document.querySelectorAll('[data-glow-injected]').length,
          glowOverlay: document.querySelectorAll('.glow-block-overlay').length,
          glowModified: document.querySelectorAll('[data-glow-modified]').length,
          glowBadges: document.querySelectorAll('.glow-badge').length,
        };
      })()
    `);
    console.log(`Selectors: ${JSON.stringify(selectorCheck)}`);

    // Check all page logs for any signal-related activity
    const allLogs = pageLogs.filter(l => l.includes('signal') || l.includes('batch') || l.includes('glow') || l.includes('chrome.runtime'));
    console.log(`\nRelevant page logs (${allLogs.length}):`);
    for (const l of allLogs.slice(0, 20)) {
      console.log(`  ${l.slice(0, 200)}`);
    }

    // List ALL page errors
    console.log(`\nAll page errors after interaction (${pageErrors.length}):`);
    for (const e of pageErrors.slice(0, 15)) {
      console.log(`  ${e.slice(0, 300)}`);
    }

    await setupPage.close();
    console.log('\nDone. Closing in 3s...');
    await sleep(3000);
  } finally {
    await browser.close();
  }
}

run().catch(console.error);

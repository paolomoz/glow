/**
 * E2E test for Lovesac + LLMO flow.
 * Validates: import index → import LLMO prompts → select prompt → generate → verify blocks.
 * Usage: npx tsx test/e2e/lovesac-llmo-test.ts
 */

import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const EXTENSION_PATH = resolve(__dirname, '../../dist/extension');
const LOVESAC_INDEX_PATH = resolve(__dirname, '../../data/www.lovesac.com-demo.json');
const LLMO_PROMPTS_PATH = resolve(__dirname, '../../llmo/lovesac-prompts.json');
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
      `--user-data-dir=/tmp/glow-lovesac-${Date.now()}`,
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

    // Step 1: Import Lovesac index
    console.log('\n--- Step 1: Import Lovesac index ---');
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

    // Import Lovesac content index
    const indexStr = readFileSync(LOVESAC_INDEX_PATH, 'utf8');
    const importResult: any = await setupPage.evaluate(`
      new Promise((resolve) => {
        const index = ${indexStr};
        chrome.runtime.sendMessage(
          { type: 'IMPORT_INDEX', index },
          (response) => resolve(response),
        );
      })
    `);
    console.log(`Index import: ${JSON.stringify(importResult)}`);

    if (!importResult?.success) {
      console.error('✗ Index import failed');
      return;
    }
    console.log(`✓ ${importResult.atomCount} atoms, ${importResult.templateCount} templates`);

    // Step 2: Send LLMO signals
    console.log('\n--- Step 2: Send LLMO prompt signals ---');
    const llmoPrompts = JSON.parse(readFileSync(LLMO_PROMPTS_PATH, 'utf8'));
    const testPrompt = llmoPrompts.find((p: any) => p.intent === 'comparative') ?? llmoPrompts[0];
    console.log(`Test prompt: [${testPrompt.intent}] "${testPrompt.prompt.slice(0, 60)}..."`);
    console.log(`Target URL: ${testPrompt.url}`);

    const pageUrl = 'https://www.lovesac.com/';
    const now = new Date().toISOString();

    const signalResult: any = await setupPage.evaluate(`
      new Promise((resolve) => {
        const now = "${now}";
        const pageUrl = "${pageUrl}";
        chrome.runtime.sendMessage({
          type: 'SIGNAL_BATCH',
          signals: [
            {
              type: 'page_visit',
              timestamp: now,
              data: { url: pageUrl, referrer: 'https://chatgpt.com', title: 'Lovesac', source: 'llmo' },
              pageUrl,
            },
            {
              type: 'search_query',
              timestamp: now,
              data: {
                query: ${JSON.stringify(testPrompt.prompt)},
                source: 'llmo',
                llmoIntent: ${JSON.stringify(testPrompt.intent)},
                llmoTopic: ${JSON.stringify(testPrompt.topic)},
              },
              pageUrl,
            },
          ],
          pageUrl,
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      })
    `);
    console.log(`Signal result: ${JSON.stringify(signalResult)}`);

    // Step 3: Trigger explicit generation with LLMO source
    console.log('\n--- Step 3: Generate from LLMO ---');
    await sleep(1000);

    const genResult: any = await setupPage.evaluate(`
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'GENERATE', source: 'llmo' },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          }
        );
      })
    `);

    await sleep(5000); // Wait for Cerebras

    if (genResult?.blocks?.length > 0) {
      console.log(`\n✓ ${genResult.blocks.length} blocks generated!`);
      let allLlmo = true;
      for (const block of genResult.blocks) {
        console.log(`  Template: ${block.templateId}`);
        console.log(`  Selector: ${block.selector}`);
        console.log(`  Model: ${block.model} (${block.generationTimeMs}ms)`);
        console.log(`  Source: ${block.source}`);
        console.log(`  HTML: ${block.html?.slice(0, 200)}...`);
        if (block.source !== 'llmo') allLlmo = false;
      }
      console.log(allLlmo ? '\n✓ All blocks have source: llmo' : '\n✗ Some blocks missing llmo source');
    } else {
      console.log('\n✗ No blocks generated');
      console.log(`  Result: ${JSON.stringify(genResult)?.slice(0, 500)}`);
    }

    await setupPage.close();
    console.log('\nDone. Closing in 3s...');
    await sleep(3000);
  } finally {
    await browser.close();
  }
}

run().catch(console.error);

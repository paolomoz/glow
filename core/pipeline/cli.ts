#!/usr/bin/env npx tsx
// core/pipeline/cli.ts — Run the pipeline against indexed data with real Cerebras
// Usage: npx tsx core/pipeline/cli.ts <index-file> [--archetype explore|compare|dive_deep|seek_action|return] [--page-url URL]

import { readFileSync } from 'fs';
import type { ContentIndex, IntentVector, Signal } from '../types.js';
import { DefaultOrchestrator } from './orchestrator.js';
import { DefaultIntentEngine } from '../intent/engine.js';
import { DefaultCerebrasClient, CEREBRAS_BASE_URL } from '../generation/cerebras-client.js';
import { FileStorageAdapter } from '../storage/file-storage.js';

// Load .env
const envPath = new URL('../../.env', import.meta.url).pathname;
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch { /* no .env */ }

const args = process.argv.slice(2);
const indexFile = args.find((a) => !a.startsWith('--'));

if (!indexFile) {
  console.error('Usage: npx tsx core/pipeline/cli.ts <index-file> [--archetype TYPE] [--page-url URL]');
  process.exit(1);
}

function getFlag(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const archetype = getFlag('archetype', 'compare') as IntentVector['archetype'];
const apiKey = process.env.CEREBRAS_API_KEY;

if (!apiKey) {
  console.error('CEREBRAS_API_KEY not set in .env or environment');
  process.exit(1);
}

// Load index
console.log(`Loading index from ${indexFile}...`);
const index: ContentIndex = JSON.parse(readFileSync(indexFile, 'utf8'));
const pageUrl = getFlag('page-url', index.atoms[0]?.sourceUrl ?? 'https://example.com');

console.log(`  Atoms: ${index.atoms.length}`);
console.log(`  Templates: ${index.templates.length}`);
console.log(`  Site: ${index.siteId}`);
console.log(`  Archetype: ${archetype}`);
console.log(`  Page URL: ${pageUrl}\n`);

// Build synthetic signals that reliably produce the desired archetype
function buildSignalsForArchetype(arch: string, url: string): Signal[] {
  const now = new Date().toISOString();
  const base: Signal[] = [
    { type: 'page_visit', timestamp: now, data: { url, referrer: '', title: 'BMW' }, pageUrl: url },
    { type: 'scroll_depth', timestamp: now, data: { depth: 0.7, maxDepth: 0.7 }, pageUrl: url },
    { type: 'time_on_section', timestamp: now, data: { section: 'main', durationMs: 25000 }, pageUrl: url },
  ];

  switch (arch) {
    case 'compare':
      return [
        ...base,
        { type: 'click_target', timestamp: now, data: { text: 'Compare models', href: '/compare' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'vs X5 vs X3', href: '/compare' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'See differences', href: '/compare' }, pageUrl: url },
        { type: 'navigation', timestamp: now, data: { from: url, to: url + '/compare' }, pageUrl: url },
        // Add enough signals to boost confidence
        ...Array.from({ length: 10 }, (_, i) => ({
          type: 'page_visit' as const, timestamp: now,
          data: { url: `${url}/model-${i}`, referrer: url, title: `Model ${i}` }, pageUrl: url,
        })),
      ];
    case 'seek_action':
      return [
        ...base,
        { type: 'click_target', timestamp: now, data: { text: 'Build Your Own', href: '/build' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Get a Quote', href: '/quote' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Schedule Test Drive', href: '/test-drive' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Request a Demo', href: '/demo' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Reserve Now', href: '/reserve' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Apply for Financing', href: '/financing' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Shop Inventory', href: '/inventory' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Order Online', href: '/order' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Book Appointment', href: '/book' }, pageUrl: url },
        { type: 'form_interaction', timestamp: now, data: { fieldName: 'zip_code', action: 'focus' }, pageUrl: url },
        { type: 'form_interaction', timestamp: now, data: { fieldName: 'email', action: 'focus' }, pageUrl: url },
      ];
    case 'dive_deep':
      return [
        ...base,
        { type: 'scroll_depth', timestamp: now, data: { depth: 0.95, maxDepth: 0.95 }, pageUrl: url },
        { type: 'time_on_section', timestamp: now, data: { section: 'specs', durationMs: 60000 }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'View all specs', href: '/specs' }, pageUrl: url },
        { type: 'click_target', timestamp: now, data: { text: 'Read more details', href: '/details' }, pageUrl: url },
      ];
    case 'explore':
    default:
      return [
        ...base,
        ...Array.from({ length: 8 }, (_, i) => ({
          type: 'page_visit' as const, timestamp: now,
          data: { url: `${url}/page-${i}`, referrer: url, title: `Page ${i}` }, pageUrl: url,
        })),
      ];
  }
}

// Set up pipeline
const storage = new FileStorageAdapter(index);
const cerebrasClient = new DefaultCerebrasClient({
  apiKey,
  baseUrl: CEREBRAS_BASE_URL,
  defaultTimeoutMs: 10000,
});
const intentEngine = new DefaultIntentEngine();

const orchestrator = new DefaultOrchestrator({
  intentEngine,
  storage,
  cerebrasClient,
  brandProfile: index.brandProfile,
});

// Run pipeline — simulate a multi-round session to build confidence
// (the real system accumulates signals over time; each call reinforces the archetype)
const signals = buildSignalsForArchetype(archetype, pageUrl);
const ROUNDS = 4;
console.log(`Running ${ROUNDS} signal rounds (${signals.length} signals each) to build confidence...\n`);
const startTime = Date.now();

let result;
try {
  for (let round = 1; round <= ROUNDS; round++) {
    result = await orchestrator.process(
      index.siteId,
      'demo-session-1',
      pageUrl,
      signals,
    );
    console.log(`  Round ${round}: ${result.intent.archetype} confidence=${result.intent.confidence.toFixed(3)}, blocks=${result.blocks.length}`);
  }

  const elapsed = Date.now() - startTime;
  if (!result) { console.log('No result'); process.exit(1); }
  console.log(`\n=== Final Result (${elapsed}ms total) ===`);
  console.log(`Intent: ${result.intent.archetype} (confidence: ${result.intent.confidence.toFixed(3)})`);
  console.log(`Audience: ${result.intent.audienceMode}`);
  console.log(`Depth: ${result.intent.contentDepth}`);
  console.log(`Register: ${result.intent.emotionalRegister}`);
  console.log(`Blocks generated: ${result.blocks.length}`);
  console.log(`Cache hit: ${result.cacheHit}`);
  console.log(`Total time: ${result.totalTimeMs}ms`);

  for (const block of result.blocks) {
    console.log(`\n--- Block: ${block.templateId} ---`);
    console.log(`Model: ${block.model}`);
    console.log(`Generation time: ${block.generationTimeMs}ms`);
    console.log(`Selector: ${block.selector}`);
    console.log(`HTML preview (first 500 chars):`);
    console.log(block.html.slice(0, 500));
    console.log('...');
  }

  if (result.blocks.length === 0) {
    console.log('\nNo blocks generated.');
    console.log(`  Confidence: ${result.intent.confidence.toFixed(3)} (threshold: 0.3)`);
    console.log(`  Check: Are templates available for hero/above-fold/mid-page positions?`);
    const heroTemplates = index.templates.filter(t => t.position === 'hero');
    const aboveTemplates = index.templates.filter(t => t.position === 'above-fold');
    const midTemplates = index.templates.filter(t => t.position === 'mid-page');
    console.log(`  hero: ${heroTemplates.length}, above-fold: ${aboveTemplates.length}, mid-page: ${midTemplates.length}`);
  }
} catch (err) {
  console.error('\nPipeline failed:', err);
  process.exit(1);
}

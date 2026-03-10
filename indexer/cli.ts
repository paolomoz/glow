#!/usr/bin/env npx tsx
// indexer/cli.ts — CLI for indexing a site
// Usage: npx tsx indexer/cli.ts <url> [--max-pages N] [--output path]

import { buildContentIndex } from './index-builder.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));

if (!url) {
  console.error('Usage: npx tsx indexer/cli.ts <url> [--max-pages N] [--output path]');
  process.exit(1);
}

function getFlag(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const maxPages = parseInt(getFlag('max-pages', '20'), 10);
const outputDir = getFlag('output', join(import.meta.dirname!, '..', 'data'));
const siteId = new URL(url).hostname;

console.log(`\nIndexing ${url}`);
console.log(`  Site ID: ${siteId}`);
console.log(`  Max pages: ${maxPages}`);
console.log(`  Output: ${outputDir}\n`);

const startTime = Date.now();

try {
  const index = await buildContentIndex({
    siteId,
    seedUrl: url,
    crawler: {
      maxPages,
      maxDepth: 2,
      crawlDelayMs: 500,
    },
    onProgress: (stage, detail) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${elapsed}s] [${stage}] ${detail}`);
    },
  });

  // Write output
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${siteId}.json`);
  writeFileSync(outputPath, JSON.stringify(index, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  Pages crawled: ${index.pageCount}`);
  console.log(`  Atoms extracted: ${index.atoms.length}`);
  console.log(`  Templates extracted: ${index.templates.length}`);
  console.log(`  Site type: ${index.brandProfile.siteType}`);
  console.log(`  Output: ${outputPath}`);
} catch (err) {
  console.error('\nIndexing failed:', err);
  process.exit(1);
}

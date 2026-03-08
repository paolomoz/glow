// indexer/index-builder.ts — Orchestrate the full indexing pipeline
// CC-1.5.6: Wire crawler → extractor → embedder → profiler into a single pipeline

import type {
  ContentIndex,
  ContentAtom,
  BlockTemplate,
  BrandProfile,
} from '@glow/core';
import type { CerebrasClient } from '../core/generation/cerebras-client.js';
import type { CrawlerConfig, CrawlProgress } from './crawler.js';
import type { EmbedderConfig } from './embedder.js';
import type { ProfilerConfig } from './profiler.js';
import type { ChunkerOptions } from './chunker.js';
import type { StructuredData } from './extractor/structured-data.js';

import { crawlSite } from './crawler.js';
import { detectBlocks } from './extractor/block-detector.js';
import { extractTemplates } from './extractor/template-extractor.js';
import { extractAllAtoms } from './extractor/atom-extractor.js';
import { extractStructuredData } from './extractor/structured-data.js';
import { chunkAtoms } from './chunker.js';
import { generateEmbeddings, applyEmbeddingsToAtoms } from './embedder.js';
import { buildBrandProfile, buildFallbackProfile } from './profiler.js';
import { classifySiteType } from '../core/skills/classifier.js';
import { getSkillConfigName } from '../core/skills/loader.js';

/** Configuration for the full index-building pipeline. */
export interface IndexBuilderConfig {
  /** Unique site identifier */
  siteId: string;
  /** Seed URL to start crawling from */
  seedUrl: string;
  /** Crawler configuration overrides */
  crawler?: Partial<CrawlerConfig>;
  /** Chunker options */
  chunker?: ChunkerOptions;
  /** Embedder config (required for embedding generation) */
  embedder?: EmbedderConfig;
  /** Cerebras client (required for LLM-based brand profiling) */
  cerebrasClient?: CerebrasClient;
  /** Profiler config overrides */
  profiler?: ProfilerConfig;
  /** Progress callback */
  onProgress?: (stage: IndexingStage, detail: string) => void;
}

export type IndexingStage =
  | 'crawling'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'classifying'
  | 'profiling'
  | 'complete';

/**
 * Build a complete content index for a site.
 * Pipeline: crawl → extract blocks/atoms/structured data → chunk → embed → classify → profile.
 *
 * Embedding and LLM profiling are optional — when not configured, the pipeline
 * skips those stages and uses heuristic fallbacks.
 */
export async function buildContentIndex(
  config: IndexBuilderConfig,
): Promise<ContentIndex> {
  const { siteId, seedUrl, onProgress } = config;

  // Stage 1: Crawl
  onProgress?.('crawling', `Starting crawl from ${seedUrl}`);
  const crawlProgress: CrawlProgress = (url, count, total) => {
    onProgress?.('crawling', `Crawled ${count}/${total}: ${url}`);
  };

  const crawlResults = await crawlSite(seedUrl, {
    maxPages: config.crawler?.maxPages ?? 50,
    maxDepth: config.crawler?.maxDepth ?? 3,
    respectRobots: config.crawler?.respectRobots ?? true,
    useSitemap: config.crawler?.useSitemap ?? true,
    onProgress: crawlProgress,
    ...config.crawler,
  });

  // Stage 2: Extract
  onProgress?.('extracting', `Extracting content from ${crawlResults.length} pages`);

  const allAtoms: ContentAtom[] = [];
  const allTemplates: BlockTemplate[] = [];
  const allStructuredData: StructuredData[] = [];
  const allUrls: string[] = [];
  const allContentSamples: string[] = [];

  for (const result of crawlResults) {
    // Parse HTML into a document — use DOMParser in browser or a provided parser
    const doc = parseHtml(result.html, result.url);
    if (!doc) continue;

    allUrls.push(result.url);

    // Detect blocks
    const blocks = detectBlocks(doc);

    // Extract templates
    const templates = extractTemplates(blocks, {
      siteId,
      sourceUrl: result.url,
    }, doc);
    allTemplates.push(...templates);

    // Extract atoms
    const atoms = extractAllAtoms(blocks, { sourceUrl: result.url });
    allAtoms.push(...atoms);

    // Extract structured data
    const sd = extractStructuredData(doc);
    allStructuredData.push(sd);

    // Sample content for classification
    const pageText = atoms.map((a) => a.content).join(' ');
    if (pageText.length > 0) {
      allContentSamples.push(pageText.slice(0, 2000));
    }
  }

  onProgress?.('extracting', `Extracted ${allAtoms.length} atoms, ${allTemplates.length} templates`);

  // Stage 3: Chunk
  onProgress?.('chunking', `Chunking ${allAtoms.length} atoms`);
  const chunks = chunkAtoms(allAtoms, config.chunker);

  // Stage 4: Embed (optional)
  let embeddedAtoms = allAtoms;
  if (config.embedder) {
    onProgress?.('embedding', `Generating embeddings for ${chunks.length} chunks`);
    const embeddings = await generateEmbeddings(chunks, config.embedder);
    embeddedAtoms = applyEmbeddingsToAtoms(allAtoms, embeddings);
    onProgress?.('embedding', `Generated ${embeddings.length} embeddings`);
  }

  // Stage 5: Classify
  onProgress?.('classifying', 'Classifying site type');
  const sdForClassification = allStructuredData.flatMap((sd) =>
    sd.jsonLd as Record<string, unknown>[],
  );
  const classification = classifySiteType(
    allUrls,
    allContentSamples,
    sdForClassification,
  );
  const skillConfigName = getSkillConfigName(classification.siteType);

  onProgress?.('classifying', `Classified as ${classification.siteType} (confidence: ${classification.confidence})`);

  // Stage 6: Profile
  onProgress?.('profiling', 'Building brand profile');
  let brandProfile: BrandProfile;

  if (config.cerebrasClient) {
    const combinedStructuredData: StructuredData = {
      jsonLd: allStructuredData.flatMap((sd) => sd.jsonLd),
      openGraph: allStructuredData.reduce((acc, sd) => ({ ...acc, ...sd.openGraph }), {}),
      metaTags: allStructuredData.reduce((acc, sd) => ({ ...acc, ...sd.metaTags }), {}),
      twitterCard: allStructuredData.reduce((acc, sd) => ({ ...acc, ...sd.twitterCard }), {}),
      microdata: allStructuredData.flatMap((sd) => sd.microdata),
    };

    brandProfile = await buildBrandProfile(
      siteId,
      embeddedAtoms,
      allTemplates,
      combinedStructuredData,
      classification.siteType,
      skillConfigName,
      config.cerebrasClient,
      config.profiler,
    );
  } else {
    brandProfile = buildFallbackProfile(
      siteId,
      embeddedAtoms,
      allTemplates,
      classification.siteType,
      skillConfigName,
    );
  }

  onProgress?.('complete', 'Index build complete');

  return {
    siteId,
    atoms: embeddedAtoms,
    templates: allTemplates,
    brandProfile,
    crawledAt: new Date().toISOString(),
    pageCount: crawlResults.length,
  };
}

// ---------------------------------------------------------------------------
// HTML parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse HTML string into a Document.
 * Works in browser via DOMParser and in Node via JSDOM (if available).
 */
function parseHtml(html: string, url: string): Document | null {
  // Browser environment
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      return parser.parseFromString(html, 'text/html');
    } catch {
      return null;
    }
  }

  // Node environment — try JSDOM if available
  try {
    // Dynamic import to avoid bundling JSDOM in browser builds
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html, { url });
    return dom.window.document;
  } catch {
    return null;
  }
}

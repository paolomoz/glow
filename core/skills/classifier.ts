import type { SiteType } from '../types.js';

export interface ClassificationResult {
  siteType: SiteType;
  confidence: number;
  indicators: string[];
}

/**
 * Auto-classifies website type during indexing.
 * Uses rule-based first pass with optional LLM confirmation.
 */
export interface SiteClassifier {
  classify(
    urls: string[],
    sampleContent: string[],
    structuredData: Record<string, unknown>[]
  ): ClassificationResult;
}

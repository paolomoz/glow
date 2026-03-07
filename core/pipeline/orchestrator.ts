import type { Signal, PipelineResult, BlockReplacement } from '../types.js';

/**
 * Main pipeline: signals in → personalized blocks out.
 * Coordinates intent → retrieval → generation within the 2.5s budget.
 */
export interface Orchestrator {
  process(
    siteId: string,
    sessionId: string,
    pageUrl: string,
    signals: Signal[]
  ): Promise<PipelineResult>;
}

import type { IntentVector } from '../types.js';

export interface PredictedPage {
  url: string;
  probability: number;
}

/**
 * Predicts likely next pages and triggers background pre-generation.
 */
export interface SpeculativePreGenerator {
  predictNextPages(
    currentPageUrl: string,
    intent: IntentVector,
    siteNavigation: string[]
  ): PredictedPage[];

  preGenerate(
    siteId: string,
    sessionId: string,
    pages: PredictedPage[],
    intent: IntentVector
  ): Promise<void>;
}

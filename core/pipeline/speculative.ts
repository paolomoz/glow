// core/pipeline/speculative.ts — Speculative pre-generation for next pages
// CC-2.4.2: Predict likely next pages and pre-generate blocks in background

import type { IntentVector } from '../types.js';
import { MODERATE_CONFIDENCE_THRESHOLD, SPECULATIVE_CACHE_TTL_SECONDS } from '../types.js';

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

/** Maximum number of pages to speculatively pre-generate. */
const MAX_SPECULATIVE_PAGES = 3;
/** Minimum probability to trigger pre-generation for a page. */
const MIN_PREDICTION_PROBABILITY = 0.2;

/**
 * Default speculative pre-generator.
 * Uses intent archetype and navigation patterns to predict next pages.
 */
export class DefaultSpeculativePreGenerator implements SpeculativePreGenerator {
  /** Callback to trigger pre-generation for a page (set by orchestrator). */
  private onPreGenerate?: (
    siteId: string,
    sessionId: string,
    pageUrl: string,
    intent: IntentVector,
  ) => Promise<void>;

  constructor(
    onPreGenerate?: (
      siteId: string,
      sessionId: string,
      pageUrl: string,
      intent: IntentVector,
    ) => Promise<void>,
  ) {
    this.onPreGenerate = onPreGenerate;
  }

  /**
   * Predict the top-3 most likely next pages based on:
   * - Intent archetype (e.g. compare → pricing, explore → features)
   * - Navigation history
   * - Available site navigation links
   */
  predictNextPages(
    currentPageUrl: string,
    intent: IntentVector,
    siteNavigation: string[],
  ): PredictedPage[] {
    // Only predict if confidence is high enough
    if (intent.confidence < MODERATE_CONFIDENCE_THRESHOLD) {
      return [];
    }

    const predictions: PredictedPage[] = [];
    const currentPath = extractPath(currentPageUrl);

    // Score each navigation URL based on intent alignment
    for (const navUrl of siteNavigation) {
      const navPath = extractPath(navUrl);
      if (navPath === currentPath) continue; // Skip current page

      const probability = scorePrediction(navPath, intent);
      if (probability >= MIN_PREDICTION_PROBABILITY) {
        predictions.push({ url: navUrl, probability });
      }
    }

    // Sort by probability and take top N
    predictions.sort((a, b) => b.probability - a.probability);
    return predictions.slice(0, MAX_SPECULATIVE_PAGES);
  }

  /**
   * Trigger background pre-generation for predicted pages.
   * Fire-and-forget — failures are silently ignored.
   */
  async preGenerate(
    siteId: string,
    sessionId: string,
    pages: PredictedPage[],
    intent: IntentVector,
  ): Promise<void> {
    if (!this.onPreGenerate) return;

    const promises = pages.map((page) =>
      this.onPreGenerate!(siteId, sessionId, page.url, intent).catch(
        () => {}, // Silently ignore pre-generation failures
      ),
    );

    await Promise.allSettled(promises);
  }
}

// ---------------------------------------------------------------------------
// Prediction helpers
// ---------------------------------------------------------------------------

/** Score how likely the user will navigate to a given path based on intent. */
function scorePrediction(path: string, intent: IntentVector): number {
  const lowerPath = path.toLowerCase();
  let score = 0.1; // Base probability

  // Archetype-based URL scoring
  switch (intent.archetype) {
    case 'explore':
      if (matchesAny(lowerPath, ['feature', 'about', 'overview', 'how'])) score += 0.3;
      if (matchesAny(lowerPath, ['blog', 'resource', 'guide'])) score += 0.2;
      break;
    case 'compare':
      if (matchesAny(lowerPath, ['pricing', 'plan', 'compare', 'versus'])) score += 0.4;
      if (matchesAny(lowerPath, ['feature', 'spec'])) score += 0.2;
      break;
    case 'dive_deep':
      if (matchesAny(lowerPath, ['doc', 'api', 'detail', 'spec'])) score += 0.3;
      if (matchesAny(lowerPath, ['guide', 'tutorial', 'reference'])) score += 0.3;
      break;
    case 'seek_action':
      if (matchesAny(lowerPath, ['signup', 'register', 'demo', 'trial'])) score += 0.4;
      if (matchesAny(lowerPath, ['contact', 'get-started', 'download'])) score += 0.3;
      break;
    case 'return':
      if (matchesAny(lowerPath, ['dashboard', 'account', 'setting'])) score += 0.3;
      if (matchesAny(lowerPath, ['support', 'help', 'faq'])) score += 0.2;
      break;
  }

  // Confidence amplifier — higher confidence means stronger predictions
  score *= 0.5 + intent.confidence * 0.5;

  return Math.min(1.0, score);
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => path.includes(p));
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

import type { AtomPerformance, ContentAtom } from '../types.js';

/**
 * Scores content atom performance based on aggregated engagement data.
 */
export interface AtomScorer {
  score(atom: ContentAtom, events: { impressions: number; interactions: number; conversions: number }): AtomPerformance;
}

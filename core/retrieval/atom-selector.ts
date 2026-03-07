import type { ContentAtom, IntentVector } from '../types.js';

export interface RankedAtom {
  atom: ContentAtom;
  score: number;
  relevanceBreakdown: {
    semanticSimilarity: number;
    intentAlignment: number;
    freshness: number;
    performanceHistory: number;
  };
}

/**
 * Ranks and selects the best content atoms for a generation request.
 */
export interface AtomSelector {
  rank(atoms: ContentAtom[], intent: IntentVector): RankedAtom[];
  select(atoms: ContentAtom[], intent: IntentVector, maxAtoms: number): ContentAtom[];
}

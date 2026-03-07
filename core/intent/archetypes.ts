import type { IntentArchetype } from '../types.js';

/**
 * Pre-computed intent archetypes used for cosine similarity matching.
 * Each archetype defines expected signal feature patterns.
 */
export interface ArchetypeProfile {
  archetype: IntentArchetype;
  label: string;
  description: string;
  featureWeights: {
    pagesVisitedDiversity: number;  // high = explore, low = dive_deep
    avgTimePerPage: number;         // high = dive_deep, low = explore
    scrollDepthAvg: number;         // high = dive_deep
    ctaClickRate: number;           // high = seek_action
    comparisonRate: number;         // high = compare
    returnVisitRate: number;        // high = return
  };
}

export const ARCHETYPE_PROFILES: ArchetypeProfile[] = [
  {
    archetype: 'explore',
    label: 'Exploring',
    description: 'Broad browsing, short time per page, diverse topics',
    featureWeights: {
      pagesVisitedDiversity: 1.0,
      avgTimePerPage: 0.2,
      scrollDepthAvg: 0.3,
      ctaClickRate: 0.1,
      comparisonRate: 0.2,
      returnVisitRate: 0.1,
    },
  },
  {
    archetype: 'compare',
    label: 'Comparing',
    description: 'Visiting similar pages, switching between items',
    featureWeights: {
      pagesVisitedDiversity: 0.3,
      avgTimePerPage: 0.5,
      scrollDepthAvg: 0.5,
      ctaClickRate: 0.3,
      comparisonRate: 1.0,
      returnVisitRate: 0.5,
    },
  },
  {
    archetype: 'dive_deep',
    label: 'Deep diving',
    description: 'Long time on single topic, scrolling to bottom, expanding details',
    featureWeights: {
      pagesVisitedDiversity: 0.1,
      avgTimePerPage: 1.0,
      scrollDepthAvg: 1.0,
      ctaClickRate: 0.2,
      comparisonRate: 0.1,
      returnVisitRate: 0.2,
    },
  },
  {
    archetype: 'seek_action',
    label: 'Seeking action',
    description: 'Clicking CTAs, visiting pricing/contact, filling forms',
    featureWeights: {
      pagesVisitedDiversity: 0.3,
      avgTimePerPage: 0.4,
      scrollDepthAvg: 0.4,
      ctaClickRate: 1.0,
      comparisonRate: 0.3,
      returnVisitRate: 0.2,
    },
  },
  {
    archetype: 'return',
    label: 'Returning',
    description: 'Revisiting previously seen content',
    featureWeights: {
      pagesVisitedDiversity: 0.2,
      avgTimePerPage: 0.5,
      scrollDepthAvg: 0.5,
      ctaClickRate: 0.3,
      comparisonRate: 0.2,
      returnVisitRate: 1.0,
    },
  },
];

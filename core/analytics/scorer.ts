// core/analytics/scorer.ts — Content atom performance scoring
// CC-6.2: Aggregate engagement per content atom

import type {
  AtomPerformance,
  ContentAtom,
  IntentArchetype,
  AnalyticsEvent,
} from '../types.js';

/**
 * Scores content atom performance based on aggregated engagement data.
 */
export interface AtomScorer {
  score(
    atom: ContentAtom,
    events: { impressions: number; interactions: number; conversions: number },
  ): AtomPerformance;
  aggregate(atomId: string, events: AnalyticsEvent[]): AggregatedMetrics;
  rank(atoms: ContentAtom[]): RankedAtom[];
}

export interface AggregatedMetrics {
  atomId: string;
  impressions: number;
  interactions: number;
  conversions: number;
  totalDwellMs: number;
  audienceBreakdown: Partial<Record<IntentArchetype, number>>;
}

export interface RankedAtom {
  atom: ContentAtom;
  performanceScore: number;
}

/**
 * Default scorer that computes engagement metrics and performance rankings.
 */
export class DefaultAtomScorer implements AtomScorer {
  /**
   * Compute performance metrics for a single atom.
   */
  score(
    atom: ContentAtom,
    events: { impressions: number; interactions: number; conversions: number },
  ): AtomPerformance {
    const engagementRate =
      events.impressions > 0 ? events.interactions / events.impressions : 0;

    const conversionLift =
      events.impressions > 0 ? events.conversions / events.impressions : 0;

    return {
      usageCount: (atom.performance?.usageCount ?? 0) + 1,
      impressions: (atom.performance?.impressions ?? 0) + events.impressions,
      engagementRate,
      conversionLift,
      lastUsed: new Date().toISOString(),
      audienceBreakdown: atom.performance?.audienceBreakdown ?? ({} as Record<IntentArchetype, number>),
    };
  }

  /**
   * Aggregate raw analytics events into metrics for a specific atom.
   */
  aggregate(atomId: string, events: AnalyticsEvent[]): AggregatedMetrics {
    const metrics: AggregatedMetrics = {
      atomId,
      impressions: 0,
      interactions: 0,
      conversions: 0,
      totalDwellMs: 0,
      audienceBreakdown: {},
    };

    for (const event of events) {
      if (!event.atomIds.includes(atomId)) continue;

      switch (event.type) {
        case 'impression':
          metrics.impressions++;
          break;
        case 'interaction':
          metrics.interactions++;
          break;
        case 'conversion':
          metrics.conversions++;
          break;
        case 'dwell':
          metrics.totalDwellMs += (event.data.dwellMs as number) ?? 0;
          break;
      }
    }

    return metrics;
  }

  /**
   * Rank atoms by composite performance score.
   * Score weights: engagement (0.4) + conversion lift (0.4) + usage freshness (0.2)
   */
  rank(atoms: ContentAtom[]): RankedAtom[] {
    const now = Date.now();

    return atoms
      .map((atom) => {
        const perf = atom.performance;
        if (!perf || perf.impressions === 0) {
          return { atom, performanceScore: 0 };
        }

        const engagementScore = Math.min(1, perf.engagementRate * 5);
        const conversionScore = Math.min(1, perf.conversionLift * 10);

        const lastUsedMs = perf.lastUsed
          ? now - new Date(perf.lastUsed).getTime()
          : Infinity;
        const freshnessScore = Math.max(
          0,
          1 - lastUsedMs / (30 * 24 * 60 * 60 * 1000),
        );

        const performanceScore =
          engagementScore * 0.4 +
          conversionScore * 0.4 +
          freshnessScore * 0.2;

        return { atom, performanceScore };
      })
      .sort((a, b) => b.performanceScore - a.performanceScore);
  }
}

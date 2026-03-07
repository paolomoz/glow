import type { Signal, SignalType } from '../types.js';

/**
 * Normalizes raw events into typed Signal objects with timestamps.
 */
export interface SignalNormalizer {
  normalize(rawEvent: Record<string, unknown>, pageUrl: string): Signal;
  batch(signals: Signal[]): Signal[];
}

export interface AggregatedSignals {
  pagesVisited: { url: string; category: string; recency: number }[];
  engagementDepth: { avgScrollPercent: number; timeDistribution: Record<string, number> };
  navigationPattern: 'linear' | 'branching' | 'returning' | 'search-driven';
  clickIntent: { ctaClicks: number; comparisonClicks: number; detailExpansions: number };
  temporalPattern: 'rapid-scanning' | 'deep-reading' | 'mixed';
  signalCounts: Partial<Record<SignalType, number>>;
}

/**
 * Aggregates a batch of signals into session-level features.
 */
export interface SignalAggregator {
  aggregate(signals: Signal[]): AggregatedSignals;
}

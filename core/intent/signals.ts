import type {
  Signal,
  SignalType,
  PageVisitData,
  ScrollDepthData,
  ClickTargetData,
  HoverDwellData,
  SearchQueryData,
  FilterSelectData,
  NavigationData,
  TimeOnSectionData,
  FormInteractionData,
  ViewportBlockVisibilityData,
  SIGNAL_BATCH_INTERVAL_MS,
} from '../types.js';

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

// =============================================================================
// Implementations
// =============================================================================

const VALID_SIGNAL_TYPES: Set<string> = new Set<string>([
  'page_visit',
  'scroll_depth',
  'click_target',
  'hover_dwell',
  'search_query',
  'filter_select',
  'navigation',
  'time_on_section',
  'form_interaction',
  'viewport_block_visibility',
]);

const CTA_PATTERNS = /\b(buy|sign.?up|subscribe|get.?started|register|download|try|free.?trial|add.?to.?cart|checkout|contact|demo|pricing)\b/i;
const COMPARISON_PATTERNS = /\b(compare|versus|vs|difference|alternative|similar|review)\b/i;
const DETAIL_PATTERNS = /\b(expand|more|detail|read.?more|show|learn.?more|view.?all)\b/i;

/**
 * Default signal normalizer — validates and transforms raw events into Signals.
 */
export class DefaultSignalNormalizer implements SignalNormalizer {
  normalize(rawEvent: Record<string, unknown>, pageUrl: string): Signal {
    const type = rawEvent.type as string;
    if (!VALID_SIGNAL_TYPES.has(type)) {
      throw new Error(`Unknown signal type: ${type}`);
    }

    return {
      type: type as SignalType,
      timestamp: (rawEvent.timestamp as string) || new Date().toISOString(),
      data: (rawEvent.data as Record<string, unknown>) || {},
      pageUrl: (rawEvent.pageUrl as string) || pageUrl,
    };
  }

  /** Deduplicate signals within the batch interval window. */
  batch(signals: Signal[]): Signal[] {
    if (signals.length <= 1) return signals;

    const result: Signal[] = [];
    const seen = new Map<string, number>(); // key -> index in result

    for (const signal of signals) {
      const key = `${signal.type}:${signal.pageUrl}:${JSON.stringify(signal.data)}`;
      const existingIdx = seen.get(key);

      if (existingIdx !== undefined) {
        // Keep the more recent signal
        const existing = result[existingIdx];
        if (signal.timestamp > existing.timestamp) {
          result[existingIdx] = signal;
        }
      } else {
        seen.set(key, result.length);
        result.push(signal);
      }
    }

    return result;
  }
}

/**
 * Default signal aggregator — produces session-level features from a batch of signals.
 */
export class DefaultSignalAggregator implements SignalAggregator {
  aggregate(signals: Signal[]): AggregatedSignals {
    const signalCounts: Partial<Record<SignalType, number>> = {};
    const pages: Map<string, { category: string; lastSeen: string }> = new Map();
    const scrollDepths: number[] = [];
    const sectionTimes: Record<string, number> = {};
    let ctaClicks = 0;
    let comparisonClicks = 0;
    let detailExpansions = 0;
    const navSequence: string[] = [];
    let hasSearch = false;

    for (const signal of signals) {
      // Count signals by type
      signalCounts[signal.type] = (signalCounts[signal.type] ?? 0) + 1;

      switch (signal.type) {
        case 'page_visit': {
          const data = signal.data as unknown as PageVisitData;
          pages.set(data.url || signal.pageUrl, {
            category: categorizeUrl(data.url || signal.pageUrl),
            lastSeen: signal.timestamp,
          });
          navSequence.push(data.url || signal.pageUrl);
          break;
        }
        case 'scroll_depth': {
          const data = signal.data as unknown as ScrollDepthData;
          scrollDepths.push(data.depth ?? 0);
          break;
        }
        case 'click_target': {
          const data = signal.data as unknown as ClickTargetData;
          const text = data.text || '';
          const href = data.href || '';
          if (CTA_PATTERNS.test(text) || CTA_PATTERNS.test(href)) {
            ctaClicks++;
          }
          if (COMPARISON_PATTERNS.test(text) || COMPARISON_PATTERNS.test(href)) {
            comparisonClicks++;
          }
          if (DETAIL_PATTERNS.test(text)) {
            detailExpansions++;
          }
          break;
        }
        case 'search_query': {
          hasSearch = true;
          break;
        }
        case 'time_on_section': {
          const data = signal.data as unknown as TimeOnSectionData;
          const section = data.sectionId || 'unknown';
          sectionTimes[section] = (sectionTimes[section] ?? 0) + (data.durationMs ?? 0);
          break;
        }
        case 'navigation': {
          const data = signal.data as unknown as NavigationData;
          navSequence.push(data.to);
          break;
        }
        // Other signal types are counted but don't contribute to aggregated features
      }
    }

    // Build pages visited list
    const now = Date.now();
    const pagesVisited = [...pages.entries()].map(([url, info]) => ({
      url,
      category: info.category,
      recency: Math.max(0, now - new Date(info.lastSeen).getTime()),
    }));

    // Engagement depth
    const avgScrollPercent =
      scrollDepths.length > 0
        ? scrollDepths.reduce((a, b) => a + b, 0) / scrollDepths.length
        : 0;

    // Navigation pattern
    const navigationPattern = inferNavigationPattern(navSequence, hasSearch, pagesVisited);

    // Temporal pattern
    const totalSectionTime = Object.values(sectionTimes).reduce((a, b) => a + b, 0);
    const avgTimePerPage = pagesVisited.length > 0 ? totalSectionTime / pagesVisited.length : 0;
    const temporalPattern = inferTemporalPattern(avgTimePerPage, avgScrollPercent);

    return {
      pagesVisited,
      engagementDepth: { avgScrollPercent, timeDistribution: sectionTimes },
      navigationPattern,
      clickIntent: { ctaClicks, comparisonClicks, detailExpansions },
      temporalPattern,
      signalCounts,
    };
  }
}

/** Categorize a URL into a rough content category based on path segments. */
function categorizeUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path === '/' || path === '') return 'home';
    if (path.includes('product') || path.includes('item')) return 'product';
    if (path.includes('blog') || path.includes('article') || path.includes('news')) return 'content';
    if (path.includes('pricing') || path.includes('plan')) return 'pricing';
    if (path.includes('about') || path.includes('team')) return 'about';
    if (path.includes('contact') || path.includes('support')) return 'support';
    if (path.includes('doc') || path.includes('guide') || path.includes('help')) return 'docs';
    if (path.includes('search') || path.includes('result')) return 'search';
    return 'other';
  } catch {
    return 'other';
  }
}

/** Infer navigation pattern from the sequence of visited URLs. */
function inferNavigationPattern(
  navSequence: string[],
  hasSearch: boolean,
  pages: { url: string }[]
): AggregatedSignals['navigationPattern'] {
  if (hasSearch) return 'search-driven';

  // Check for returning pattern — revisiting previously seen URLs
  const unique = new Set(navSequence);
  if (navSequence.length > unique.size * 1.5) return 'returning';

  // Check for branching — visiting diverse categories
  const categories = new Set(pages.map((p) => categorizeUrl(p.url)));
  if (categories.size >= 3) return 'branching';

  return 'linear';
}

/** Infer temporal reading pattern. */
function inferTemporalPattern(
  avgTimePerPageMs: number,
  avgScrollPercent: number
): AggregatedSignals['temporalPattern'] {
  // Deep reading: high time + high scroll
  if (avgTimePerPageMs > 30000 && avgScrollPercent > 0.6) return 'deep-reading';
  // Rapid scanning: low time or low scroll
  if (avgTimePerPageMs < 10000 || avgScrollPercent < 0.3) return 'rapid-scanning';
  return 'mixed';
}

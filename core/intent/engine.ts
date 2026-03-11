import type {
  IntentVector,
  IntentArchetype,
  IntentSnapshot,
  Signal,
  AudienceDepth,
  ContentDepth,
  EmotionalRegister,
} from '../types.js';
import type { AggregatedSignals } from './signals.js';
import { DefaultSignalNormalizer, DefaultSignalAggregator } from './signals.js';
import { ARCHETYPE_PROFILES, type ArchetypeProfile } from './archetypes.js';

/**
 * Rules-based intent inference engine. No LLM calls — must be sub-100ms.
 * Uses signal aggregation + cosine similarity against pre-computed archetypes.
 */
export interface IntentEngine {
  /** Update intent state with a new batch of signals. */
  ingestSignals(currentIntent: IntentVector | null, signals: Signal[]): IntentVector;

  /** Infer intent from already-aggregated signals. */
  inferFromAggregated(
    currentIntent: IntentVector | null,
    aggregated: AggregatedSignals,
    sessionId: string
  ): IntentVector;
}

// =============================================================================
// Implementation
// =============================================================================

/** Momentum weight for blending new inference with prior intent (0-1). */
const MOMENTUM = 0.3;

/**
 * Default rules-based intent engine.
 * Converts aggregated signals into a feature vector, then matches against
 * archetype profiles using cosine similarity. No LLM calls.
 */
export class DefaultIntentEngine implements IntentEngine {
  private normalizer = new DefaultSignalNormalizer();
  private aggregator = new DefaultSignalAggregator();

  /** Stash raw signals for topic extraction (not persisted). */
  private pendingSignals: Signal[] = [];

  ingestSignals(currentIntent: IntentVector | null, signals: Signal[]): IntentVector {
    this.pendingSignals = signals;
    const batched = this.normalizer.batch(signals);
    const aggregated = this.aggregator.aggregate(batched);
    const sessionId = currentIntent?.sessionId ?? generateSessionId();
    return this.inferFromAggregated(currentIntent, aggregated, sessionId);
  }

  inferFromAggregated(
    currentIntent: IntentVector | null,
    aggregated: AggregatedSignals,
    sessionId: string
  ): IntentVector {
    // 1. Extract feature vector from aggregated signals
    const features = extractFeatures(aggregated);

    // 2. Score each archetype by cosine similarity
    const scores = scoreArchetypes(features);

    // 3. Find best match
    let bestArchetype: IntentArchetype = 'explore';
    let bestScore = -Infinity;
    for (const [archetype, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestArchetype = archetype;
      }
    }

    // 4. Compute confidence from how much the best archetype stands out
    // Subtract the minimum score to remove shared-feature baseline inflation,
    // then compute the best's share of the remaining discriminating signal.
    const allScores = [...scores.values()];
    const minScore = Math.min(...allScores);
    const adjusted = allScores.map((s) => Math.max(0, s - minScore));
    const adjustedTotal = adjusted.reduce((a, b) => a + b, 0);
    const adjustedBest = bestScore - minScore;
    let rawConfidence = adjustedTotal > 0 ? adjustedBest / adjustedTotal : 0;

    // Boost confidence with signal count (more signals = more confident)
    // Low signal counts get penalized — saturates at 10 signals for real browsing behavior
    const totalSignals = Object.values(aggregated.signalCounts).reduce((a, b) => a + (b ?? 0), 0);
    const signalBoost = Math.min(1, totalSignals / 10);
    rawConfidence = rawConfidence * (0.5 + 0.5 * signalBoost);

    // 5. Apply momentum blending with prior intent
    let confidence = rawConfidence;
    if (currentIntent) {
      if (currentIntent.archetype === bestArchetype) {
        // Reinforce — confidence grows
        confidence = Math.min(1, currentIntent.confidence * MOMENTUM + rawConfidence * (1 - MOMENTUM) + 0.05);
      } else {
        // Switching — need strong signal to override
        if (rawConfidence < currentIntent.confidence * 0.8) {
          // Not strong enough — keep current archetype
          bestArchetype = currentIntent.archetype;
          confidence = currentIntent.confidence * 0.95; // slight decay
        }
      }
    }

    confidence = clamp(confidence, 0, 1);

    // 6. Derive audience mode, content depth, emotional register
    const audienceMode = inferAudienceMode(aggregated);
    const contentDepth = inferContentDepth(aggregated, bestArchetype);
    const emotionalRegister = inferEmotionalRegister(bestArchetype, aggregated);

    // 7. Build history
    const history: IntentSnapshot[] = currentIntent?.history
      ? [...currentIntent.history]
      : [];
    history.push({
      archetype: bestArchetype,
      confidence,
      timestamp: new Date().toISOString(),
    });
    // Keep last 20 snapshots
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // 8. Extract topic keywords from search queries and other signals
    const topics = extractTopicsFromSignals(this.pendingSignals, currentIntent?.topics ?? []);

    return {
      sessionId,
      archetype: bestArchetype,
      confidence,
      topicEmbedding: currentIntent?.topicEmbedding ?? [],
      topics,
      audienceMode,
      contentDepth,
      emotionalRegister,
      signalCount: totalSignals,
      history,
      updatedAt: new Date().toISOString(),
    };
  }
}

// =============================================================================
// Feature extraction
// =============================================================================

interface FeatureVector {
  pagesVisitedDiversity: number;
  avgTimePerPage: number;
  scrollDepthAvg: number;
  ctaClickRate: number;
  comparisonRate: number;
  returnVisitRate: number;
}

/** Extract a normalized feature vector from aggregated signals. */
function extractFeatures(agg: AggregatedSignals): FeatureVector {
  const pageCount = Math.max(1, agg.pagesVisited.length);
  const categories = new Set(agg.pagesVisited.map((p) => p.category));

  // Page diversity: ratio of unique categories to pages visited, capped at 1
  const pagesVisitedDiversity = Math.min(1, categories.size / Math.max(1, Math.min(pageCount, 10)));

  // Avg time per page: normalize to 0-1 scale (60s = 1.0)
  const totalTime = Object.values(agg.engagementDepth.timeDistribution)
    .reduce((a, b) => a + b, 0);
  const avgTimeMs = totalTime / pageCount;
  const avgTimePerPage = Math.min(1, avgTimeMs / 60000);

  // Scroll depth average: already 0-1
  const scrollDepthAvg = clamp(agg.engagementDepth.avgScrollPercent, 0, 1);

  // Click intent rates: normalize by signal count
  const totalClicks = agg.clickIntent.ctaClicks + agg.clickIntent.comparisonClicks + agg.clickIntent.detailExpansions;
  const ctaClickRate = totalClicks > 0 ? agg.clickIntent.ctaClicks / totalClicks : 0;
  const comparisonRate = totalClicks > 0 ? agg.clickIntent.comparisonClicks / totalClicks : 0;

  // Return visit rate: how many pages were visited more than once
  const returnVisitRate = agg.navigationPattern === 'returning' ? 0.8 : 0.1;

  return {
    pagesVisitedDiversity,
    avgTimePerPage,
    scrollDepthAvg,
    ctaClickRate,
    comparisonRate,
    returnVisitRate,
  };
}

/** Score each archetype against the feature vector using dot product. */
function scoreArchetypes(features: FeatureVector): Map<IntentArchetype, number> {
  const scores = new Map<IntentArchetype, number>();

  for (const profile of ARCHETYPE_PROFILES) {
    const score = dotProduct(features, profile.featureWeights);
    scores.set(profile.archetype, score);
  }

  return scores;
}

/** Dot product between feature vector and archetype weights. */
function dotProduct(features: FeatureVector, weights: ArchetypeProfile['featureWeights']): number {
  return (
    features.pagesVisitedDiversity * weights.pagesVisitedDiversity +
    features.avgTimePerPage * weights.avgTimePerPage +
    features.scrollDepthAvg * weights.scrollDepthAvg +
    features.ctaClickRate * weights.ctaClickRate +
    features.comparisonRate * weights.comparisonRate +
    features.returnVisitRate * weights.returnVisitRate
  );
}

// =============================================================================
// Derived inference helpers
// =============================================================================

function inferAudienceMode(agg: AggregatedSignals): AudienceDepth {
  // Deep readers with many pages = expert
  if (agg.temporalPattern === 'deep-reading' && agg.pagesVisited.length > 5) return 'expert';
  // Rapid scanning or few pages = novice
  if (agg.temporalPattern === 'rapid-scanning' || agg.pagesVisited.length <= 2) return 'novice';
  return 'intermediate';
}

function inferContentDepth(agg: AggregatedSignals, archetype: IntentArchetype): ContentDepth {
  if (archetype === 'dive_deep') return 'comprehensive';
  if (archetype === 'explore' || agg.temporalPattern === 'rapid-scanning') return 'overview';
  return 'detailed';
}

function inferEmotionalRegister(
  archetype: IntentArchetype,
  agg: AggregatedSignals
): EmotionalRegister {
  switch (archetype) {
    case 'seek_action':
      return 'urgent';
    case 'dive_deep':
      return 'authoritative';
    case 'compare':
      return 'rational';
    case 'return':
      return 'empathetic';
    case 'explore':
    default:
      return 'inspiring';
  }
}

// =============================================================================
// Utilities
// =============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Stop words to exclude from topic extraction
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'about',
  'that', 'this', 'it', 'its', 'and', 'or', 'but', 'not', 'no', 'if',
  'so', 'than', 'too', 'very', 'just', 'also', 'more', 'how', 'what',
  'when', 'where', 'which', 'who', 'why', 'all', 'each', 'every',
  'both', 'few', 'some', 'any', 'most', 'other', 'new', 'old', 'get',
  'want', 'here', 'there', 'me', 'my', 'i', 'you', 'your', 'we',
  'our', 'they', 'them', 'their', 'he', 'she', 'him', 'her',
]);

/**
 * Extract topic keywords from raw signals (especially search_query from ChatGPT).
 * Merges with existing topics, deduplicates.
 */
function extractTopicsFromSignals(signals: Signal[], existingTopics: string[]): string[] {
  const topicSet = new Set(existingTopics.map((t) => t.toLowerCase()));

  for (const signal of signals) {
    if (signal.type === 'search_query') {
      const query = String(signal.data.query ?? '');
      // Extract meaningful words (3+ chars, not stop words)
      const words = query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
      for (const word of words) {
        topicSet.add(word);
      }

      // Also extract multi-word phrases (bigrams)
      for (let i = 0; i < words.length - 1; i++) {
        topicSet.add(`${words[i]}-${words[i + 1]}`);
      }
    }

    if (signal.type === 'click_target') {
      const text = String(signal.data.text ?? '');
      const context = String(signal.data.context ?? '');
      const combined = `${text} ${context}`.toLowerCase();
      const words = combined
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
      for (const word of words) {
        topicSet.add(word);
      }
    }
  }

  // Keep top 30 topics max
  return [...topicSet].slice(0, 30);
}

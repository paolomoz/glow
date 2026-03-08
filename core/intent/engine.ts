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

  ingestSignals(currentIntent: IntentVector | null, signals: Signal[]): IntentVector {
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

    // 4. Compute confidence (normalize best score relative to total)
    const totalScore = [...scores.values()].reduce((a, b) => a + Math.max(0, b), 0);
    let rawConfidence = totalScore > 0 ? bestScore / totalScore : 0;

    // Boost confidence with signal count (more signals = more confident)
    const totalSignals = Object.values(aggregated.signalCounts).reduce((a, b) => a + (b ?? 0), 0);
    const signalBoost = Math.min(1, totalSignals / 20); // saturates at 20 signals
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

    return {
      sessionId,
      archetype: bestArchetype,
      confidence,
      topicEmbedding: currentIntent?.topicEmbedding ?? [],
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

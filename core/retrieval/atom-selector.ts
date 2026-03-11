// core/retrieval/atom-selector.ts — Rank and select content atoms for generation
// CC-2.2.2: Score by semantic relevance, intent alignment, freshness, and performance

import type { ContentAtom, IntentVector, ContentPurpose } from '../types.js';

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

/** Weights for each scoring dimension. */
export interface ScoringWeights {
  semanticSimilarity: number;
  intentAlignment: number;
  freshness: number;
  performanceHistory: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  semanticSimilarity: 0.4,
  intentAlignment: 0.3,
  freshness: 0.15,
  performanceHistory: 0.15,
};

/**
 * Default atom selector. Ranks atoms by a weighted combination of
 * semantic similarity, intent alignment, freshness, and performance.
 */
export class DefaultAtomSelector implements AtomSelector {
  private weights: ScoringWeights;

  constructor(weights: Partial<ScoringWeights> = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  rank(atoms: ContentAtom[], intent: IntentVector): RankedAtom[] {
    const ranked = atoms.map((atom) => this.scoreAtom(atom, intent));
    return ranked.sort((a, b) => b.score - a.score);
  }

  select(
    atoms: ContentAtom[],
    intent: IntentVector,
    maxAtoms: number,
  ): ContentAtom[] {
    const ranked = this.rank(atoms, intent);
    return ranked.slice(0, maxAtoms).map((r) => r.atom);
  }

  private scoreAtom(atom: ContentAtom, intent: IntentVector): RankedAtom {
    const semanticSimilarity = this.computeSemanticSimilarity(atom, intent);
    const intentAlignment = this.computeIntentAlignment(atom, intent);
    const freshness = this.computeFreshness(atom);
    const performanceHistory = this.computePerformance(atom);

    let score =
      this.weights.semanticSimilarity * semanticSimilarity +
      this.weights.intentAlignment * intentAlignment +
      this.weights.freshness * freshness +
      this.weights.performanceHistory * performanceHistory;

    // Boost atoms whose topics overlap with intent topics
    if (intent.topics.length > 0 && atom.metadata.topics.length > 0) {
      const intentTopics = new Set(intent.topics.map((t) => t.toLowerCase()));
      const atomTopics = atom.metadata.topics.map((t) => t.toLowerCase());
      let matches = 0;
      for (const at of atomTopics) {
        // Exact match or substring match against intent topics
        for (const it of intentTopics) {
          if (at === it || at.includes(it) || it.includes(at)) {
            matches++;
            break;
          }
        }
      }
      if (matches > 0) {
        // Strong boost proportional to topic overlap
        const topicBoost = Math.min(1, matches / atomTopics.length);
        score += topicBoost * 0.5;
      }
    }

    return {
      atom,
      score,
      relevanceBreakdown: {
        semanticSimilarity,
        intentAlignment,
        freshness,
        performanceHistory,
      },
    };
  }

  /** Cosine similarity between atom embedding and intent topic embedding. */
  private computeSemanticSimilarity(
    atom: ContentAtom,
    intent: IntentVector,
  ): number {
    if (!atom.embedding || intent.topicEmbedding.length === 0) {
      return 0.5; // Neutral score when no embeddings available
    }
    return cosineSimilarity(atom.embedding, intent.topicEmbedding);
  }

  /** How well the atom's purpose aligns with the user's intent. */
  private computeIntentAlignment(
    atom: ContentAtom,
    intent: IntentVector,
  ): number {
    let score = 0;

    // Purpose alignment
    const purposeMap: Record<string, ContentPurpose[]> = {
      explore: ['inform', 'entertain'],
      compare: ['compare', 'inform'],
      dive_deep: ['inform'],
      seek_action: ['enable-action', 'persuade'],
      return: ['inform', 'enable-action'],
    };

    const preferredPurposes = purposeMap[intent.archetype] ?? ['inform'];
    if (preferredPurposes.includes(atom.metadata.purpose)) {
      score += 0.5;
    }

    // Audience depth alignment
    const depthMap: Record<string, string> = {
      overview: 'novice',
      detailed: 'intermediate',
      comprehensive: 'expert',
    };
    if (atom.metadata.audienceDepth === depthMap[intent.contentDepth]) {
      score += 0.3;
    }

    // Emotional register alignment
    if (atom.metadata.emotionalRegister === intent.emotionalRegister) {
      score += 0.2;
    }

    return score;
  }

  /** Score based on how recently the atom was updated. */
  private computeFreshness(atom: ContentAtom): number {
    const updatedAt = new Date(atom.updatedAt).getTime();
    const now = Date.now();
    const ageMs = now - updatedAt;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Decay: full score for <1 day, 0.5 at 30 days, approaching 0 at 90+ days
    return Math.max(0, 1 - ageDays / 90);
  }

  /** Score based on historical engagement metrics (Vanilla mode only). */
  private computePerformance(atom: ContentAtom): number {
    if (!atom.performance) return 0.5; // Neutral when no data

    const { engagementRate, conversionLift, usageCount } = atom.performance;

    // Weighted combination of engagement metrics
    const engagementScore = Math.min(1, engagementRate);
    const conversionScore = Math.min(1, conversionLift);
    // Prefer atoms that have enough usage data for reliable metrics
    const reliabilityBonus = Math.min(1, usageCount / 50);

    return (engagementScore * 0.4 + conversionScore * 0.4 + reliabilityBonus * 0.2);
  }
}

/** Compute cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// core/retrieval/query-builder.ts — Translate IntentVector into retrieval queries
// CC-2.2.1: Build queries with topic embedding, metadata filters, and exclusions

import type { IntentVector, ContentMetadata, AudienceDepth, ContentPurpose } from '../types.js';

export interface RetrievalQuery {
  siteId: string;
  topicEmbedding: number[];
  metadataFilters: Partial<ContentMetadata>;
  excludeAtomIds: string[];
  limit: number;
}

/**
 * Translates an IntentVector into a retrieval query for the storage layer.
 */
export interface QueryBuilder {
  build(siteId: string, intent: IntentVector, excludeAtomIds?: string[]): RetrievalQuery;
}

/** Map intent archetypes to preferred content purposes. */
const ARCHETYPE_PURPOSE_MAP: Record<string, ContentPurpose[]> = {
  explore: ['inform', 'entertain'],
  compare: ['compare', 'inform'],
  dive_deep: ['inform', 'compare'],
  seek_action: ['enable-action', 'persuade'],
  return: ['inform', 'enable-action'],
};

/** Map content depth to preferred audience depth. */
const DEPTH_TO_AUDIENCE: Record<string, AudienceDepth> = {
  overview: 'novice',
  detailed: 'intermediate',
  comprehensive: 'expert',
};

/**
 * Default query builder implementation.
 * Translates intent signals into retrieval parameters.
 */
export class DefaultQueryBuilder implements QueryBuilder {
  private defaultLimit: number;

  constructor(defaultLimit: number = 10) {
    this.defaultLimit = defaultLimit;
  }

  build(
    siteId: string,
    intent: IntentVector,
    excludeAtomIds: string[] = [],
  ): RetrievalQuery {
    // Build metadata filters based on intent
    const metadataFilters: Partial<ContentMetadata> = {};

    // Filter by audience depth derived from content depth
    const audienceDepth = DEPTH_TO_AUDIENCE[intent.contentDepth];
    if (audienceDepth) {
      metadataFilters.audienceDepth = audienceDepth;
    }

    // Filter by preferred content purpose based on archetype
    const purposes = ARCHETYPE_PURPOSE_MAP[intent.archetype];
    if (purposes && purposes.length > 0) {
      metadataFilters.purpose = purposes[0]; // Primary purpose
    }

    // Filter by emotional register
    metadataFilters.emotionalRegister = intent.emotionalRegister;

    // Pass intent topics as metadata filter for topic-based sorting in storage
    if (intent.topics.length > 0) {
      (metadataFilters as any).topics = intent.topics;
    }

    // Adjust limit based on confidence — higher confidence = more results to rank
    const limit = intent.confidence > 0.8
      ? this.defaultLimit * 2
      : this.defaultLimit;

    return {
      siteId,
      topicEmbedding: intent.topicEmbedding,
      metadataFilters,
      excludeAtomIds,
      limit,
    };
  }
}

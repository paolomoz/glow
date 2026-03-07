import type { IntentVector, ContentMetadata } from '../types.js';

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

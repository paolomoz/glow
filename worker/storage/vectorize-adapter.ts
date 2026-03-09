// worker/storage/vectorize-adapter.ts — Vectorize-backed retrieval
// CC-4.1.4: Content atom retrieval via vector similarity search

import type { ContentAtom, ContentMetadata } from '@glow/core';

interface VectorizeIndex {
  query(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
      returnValues?: boolean;
      returnMetadata?: 'all' | 'indexed' | 'none';
    },
  ): Promise<{ matches: VectorizeMatch[] }>;
  insert(
    vectors: { id: string; values: number[]; metadata?: Record<string, unknown> }[],
  ): Promise<{ count: number }>;
  upsert(
    vectors: { id: string; values: number[]; metadata?: Record<string, unknown> }[],
  ): Promise<{ count: number }>;
  deleteByIds(ids: string[]): Promise<{ count: number }>;
}

interface VectorizeMatch {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, unknown>;
}

interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

/**
 * Retrieves content atoms using Vectorize for embedding similarity search.
 * Atom payloads are stored in KV (Vectorize metadata has size limits).
 */
export class VectorizeAdapter {
  constructor(
    private vectorize: VectorizeIndex,
    private atomsKV: KVNamespace,
  ) {}

  /**
   * Query atoms by embedding similarity with optional metadata filters.
   */
  async queryAtoms(
    siteId: string,
    embedding: number[],
    filters: Partial<ContentMetadata>,
    limit: number,
  ): Promise<ContentAtom[]> {
    // Build Vectorize filter
    const filter: Record<string, unknown> = { siteId };
    if (filters.audienceDepth) {
      filter.audienceDepth = filters.audienceDepth;
    }
    if (filters.purpose) {
      filter.purpose = filters.purpose;
    }

    const results = await this.vectorize.query(embedding, {
      topK: limit,
      filter,
      returnMetadata: 'indexed',
    });

    // Fetch full atom data from KV
    const atoms = await Promise.all(
      results.matches.map(async (match) => {
        const raw = await this.atomsKV.get(`atom:${match.id}`, {
          type: 'json',
        });
        if (!raw) return null;
        return raw as ContentAtom;
      }),
    );

    return atoms.filter((a): a is ContentAtom => a !== null);
  }

  /**
   * Batch upsert atoms into Vectorize + KV during indexing.
   */
  async upsertAtoms(
    siteId: string,
    atoms: ContentAtom[],
  ): Promise<number> {
    const atomsWithEmbeddings = atoms.filter(
      (a) => a.embedding && a.embedding.length > 0,
    );

    if (atomsWithEmbeddings.length === 0) return 0;

    // Store full atom data in KV
    await Promise.all(
      atomsWithEmbeddings.map((atom) =>
        this.atomsKV.put(`atom:${atom.id}`, JSON.stringify(atom)),
      ),
    );

    // Batch upsert vectors (Vectorize supports batches of ~1000)
    const BATCH_SIZE = 100;
    let total = 0;

    for (let i = 0; i < atomsWithEmbeddings.length; i += BATCH_SIZE) {
      const batch = atomsWithEmbeddings.slice(i, i + BATCH_SIZE);
      const vectors = batch.map((atom) => ({
        id: atom.id,
        values: atom.embedding!,
        metadata: {
          siteId,
          contentType: atom.contentType,
          audienceDepth: atom.metadata.audienceDepth,
          purpose: atom.metadata.purpose,
          sourceUrl: atom.sourceUrl,
        },
      }));

      const result = await this.vectorize.upsert(vectors);
      total += result.count;
    }

    return total;
  }

  /**
   * Delete all atoms for a site.
   */
  async deleteForSite(siteId: string, atomIds: string[]): Promise<void> {
    if (atomIds.length === 0) return;

    // Delete from Vectorize
    const BATCH_SIZE = 100;
    for (let i = 0; i < atomIds.length; i += BATCH_SIZE) {
      const batch = atomIds.slice(i, i + BATCH_SIZE);
      await this.vectorize.deleteByIds(batch);
    }
  }
}

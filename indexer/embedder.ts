// indexer/embedder.ts — Generate embeddings for content chunks
// CC-1.5.2: Call Cerebras/Workers AI embedding model with batch processing

import type { ContentAtom } from '@glow/core';
import type { ContentChunk } from './chunker.js';

/** Configuration for the embedding generator. */
export interface EmbedderConfig {
  /** API endpoint for the embedding model */
  apiUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Model identifier (default: 'bge-large-en-v1.5') */
  model?: string;
  /** Maximum chunks per batch request (default: 32) */
  batchSize?: number;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
}

/** Result of embedding a single chunk. */
export interface EmbeddingResult {
  chunkId: string;
  embedding: number[];
  sourceAtomIds: string[];
}

/** Batch embedding response from the API. */
interface EmbeddingApiResponse {
  data: { index: number; embedding: number[] }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

const DEFAULT_MODEL = 'bge-large-en-v1.5';
const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Generate embeddings for an array of content chunks.
 * Batches requests to stay within API limits.
 */
export async function generateEmbeddings(
  chunks: ContentChunk[],
  config: EmbedderConfig,
): Promise<EmbeddingResult[]> {
  const model = config.model ?? DEFAULT_MODEL;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const results: EmbeddingResult[] = [];

  // Process in batches
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchResults = await embedBatch(batch, config, model);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Apply embeddings back to content atoms.
 * Matches embedding results to atoms via sourceAtomIds, using the first
 * chunk's embedding as representative for the atom.
 */
export function applyEmbeddingsToAtoms(
  atoms: ContentAtom[],
  embeddings: EmbeddingResult[],
): ContentAtom[] {
  // Build atom ID → embedding map (first chunk wins)
  const atomEmbeddings = new Map<string, number[]>();

  for (const result of embeddings) {
    for (const atomId of result.sourceAtomIds) {
      if (!atomEmbeddings.has(atomId)) {
        atomEmbeddings.set(atomId, result.embedding);
      }
    }
  }

  return atoms.map((atom) => {
    const embedding = atomEmbeddings.get(atom.id);
    if (embedding) {
      return { ...atom, embedding };
    }
    return atom;
  });
}

/** Send a batch of chunks to the embedding API. */
async function embedBatch(
  chunks: ContentChunk[],
  config: EmbedderConfig,
  model: string,
): Promise<EmbeddingResult[]> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: chunks.map((c) => c.text),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Embedding API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as EmbeddingApiResponse;

    return data.data.map((item) => ({
      chunkId: chunks[item.index].id,
      embedding: item.embedding,
      sourceAtomIds: chunks[item.index].sourceAtomIds,
    }));
  } finally {
    clearTimeout(timer);
  }
}

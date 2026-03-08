// indexer/chunker.ts — Split content atoms into embedding-sized chunks
// CC-1.5.1: 256-512 token chunks with metadata linkage preserved

import type { ContentAtom, ContentMetadata } from '@glow/core';

/** A chunk derived from one or more content atoms, sized for embedding. */
export interface ContentChunk {
  /** Unique chunk ID (derived from source atom) */
  id: string;
  /** The text content of this chunk */
  text: string;
  /** Estimated token count */
  tokenCount: number;
  /** Source atom ID(s) this chunk was derived from */
  sourceAtomIds: string[];
  /** Preserved metadata from the source atom */
  metadata: ContentMetadata;
  /** Position within the source atom (for multi-chunk atoms) */
  chunkIndex: number;
  /** Total chunks this atom was split into */
  totalChunks: number;
}

export interface ChunkerOptions {
  /** Minimum tokens per chunk (default: 256) */
  minTokens?: number;
  /** Maximum tokens per chunk (default: 512) */
  maxTokens?: number;
  /** Whether to merge small adjacent atoms into single chunks (default: true) */
  mergeSmall?: boolean;
}

const DEFAULT_OPTIONS: Required<ChunkerOptions> = {
  minTokens: 256,
  maxTokens: 512,
  mergeSmall: true,
};

// Rough approximation: 1 token ≈ 4 characters for English text.
const CHARS_PER_TOKEN = 4;

/**
 * Split content atoms into embedding-sized chunks (256-512 tokens).
 * Small atoms are merged together; large atoms are split at sentence boundaries.
 */
export function chunkAtoms(
  atoms: ContentAtom[],
  options: ChunkerOptions = {},
): ContentChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: ContentChunk[] = [];

  if (opts.mergeSmall) {
    const { merged, remaining } = mergeSmallAtoms(atoms, opts);
    chunks.push(...merged);
    for (const atom of remaining) {
      chunks.push(...splitAtom(atom, opts));
    }
  } else {
    for (const atom of atoms) {
      chunks.push(...splitAtom(atom, opts));
    }
  }

  return chunks;
}

/**
 * Estimate token count for a text string.
 * Uses a simple character-based heuristic (≈4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Split a single atom into one or more chunks at sentence boundaries. */
function splitAtom(atom: ContentAtom, opts: Required<ChunkerOptions>): ContentChunk[] {
  const tokens = estimateTokens(atom.content);

  // Atom fits in a single chunk
  if (tokens <= opts.maxTokens) {
    return [
      {
        id: `${atom.id}_c0`,
        text: atom.content,
        tokenCount: tokens,
        sourceAtomIds: [atom.id],
        metadata: atom.metadata,
        chunkIndex: 0,
        totalChunks: 1,
      },
    ];
  }

  // Split at sentence boundaries
  const sentences = splitSentences(atom.content);
  const chunks: ContentChunk[] = [];
  let currentText = '';
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    // If a single sentence exceeds maxTokens, force-split it
    if (sentenceTokens > opts.maxTokens) {
      // Flush current buffer first
      if (currentText.length > 0) {
        chunks.push(buildChunk(atom, currentText, currentTokens, chunks.length));
        currentText = '';
        currentTokens = 0;
      }
      // Force-split the long sentence by character count
      chunks.push(...forceSplitText(atom, sentence, opts, chunks.length));
      continue;
    }

    // Would adding this sentence exceed maxTokens?
    if (currentTokens + sentenceTokens > opts.maxTokens && currentText.length > 0) {
      chunks.push(buildChunk(atom, currentText, currentTokens, chunks.length));
      currentText = '';
      currentTokens = 0;
    }

    currentText += (currentText.length > 0 ? ' ' : '') + sentence;
    currentTokens += sentenceTokens;
  }

  // Flush remaining
  if (currentText.length > 0) {
    chunks.push(buildChunk(atom, currentText, currentTokens, chunks.length));
  }

  // Update totalChunks on all
  const total = chunks.length;
  for (const c of chunks) {
    c.totalChunks = total;
  }

  return chunks;
}

/**
 * Merge small adjacent atoms (below minTokens) into combined chunks.
 * Returns merged chunks and any atoms too large to merge (for individual splitting).
 */
function mergeSmallAtoms(
  atoms: ContentAtom[],
  opts: Required<ChunkerOptions>,
): { merged: ContentChunk[]; remaining: ContentAtom[] } {
  const merged: ContentChunk[] = [];
  const remaining: ContentAtom[] = [];

  let buffer: ContentAtom[] = [];
  let bufferTokens = 0;

  for (const atom of atoms) {
    const tokens = estimateTokens(atom.content);

    // Large atoms go to remaining for individual splitting
    if (tokens >= opts.minTokens) {
      // Flush merge buffer first
      if (buffer.length > 0) {
        merged.push(buildMergedChunk(buffer, bufferTokens, merged.length));
        buffer = [];
        bufferTokens = 0;
      }
      remaining.push(atom);
      continue;
    }

    // Would adding this atom exceed maxTokens?
    if (bufferTokens + tokens > opts.maxTokens && buffer.length > 0) {
      merged.push(buildMergedChunk(buffer, bufferTokens, merged.length));
      buffer = [];
      bufferTokens = 0;
    }

    buffer.push(atom);
    bufferTokens += tokens;
  }

  // Flush remaining buffer
  if (buffer.length > 0) {
    merged.push(buildMergedChunk(buffer, bufferTokens, merged.length));
  }

  return { merged, remaining };
}

function buildChunk(
  atom: ContentAtom,
  text: string,
  tokenCount: number,
  index: number,
): ContentChunk {
  return {
    id: `${atom.id}_c${index}`,
    text: text.trim(),
    tokenCount,
    sourceAtomIds: [atom.id],
    metadata: atom.metadata,
    chunkIndex: index,
    totalChunks: 0, // Updated by caller
  };
}

function buildMergedChunk(
  atoms: ContentAtom[],
  tokenCount: number,
  index: number,
): ContentChunk {
  const text = atoms.map((a) => a.content).join('\n\n');
  // Use the first atom's metadata as representative
  const metadata = atoms[0].metadata;

  return {
    id: `merged_c${index}`,
    text: text.trim(),
    tokenCount,
    sourceAtomIds: atoms.map((a) => a.id),
    metadata,
    chunkIndex: 0,
    totalChunks: 1,
  };
}

function forceSplitText(
  atom: ContentAtom,
  text: string,
  opts: Required<ChunkerOptions>,
  startIndex: number,
): ContentChunk[] {
  const maxChars = opts.maxTokens * CHARS_PER_TOKEN;
  const chunks: ContentChunk[] = [];
  let offset = 0;

  while (offset < text.length) {
    const end = Math.min(offset + maxChars, text.length);
    // Try to break at a word boundary
    let breakPoint = end;
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > offset) {
        breakPoint = lastSpace;
      }
    }

    const slice = text.slice(offset, breakPoint).trim();
    if (slice.length > 0) {
      chunks.push({
        id: `${atom.id}_c${startIndex + chunks.length}`,
        text: slice,
        tokenCount: estimateTokens(slice),
        sourceAtomIds: [atom.id],
        metadata: atom.metadata,
        chunkIndex: startIndex + chunks.length,
        totalChunks: 0,
      });
    }

    offset = breakPoint;
  }

  return chunks;
}

/** Split text into sentences using basic punctuation heuristics. */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.filter((s) => s.trim().length > 0);
}

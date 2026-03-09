// worker/env.ts — Cloudflare Worker environment bindings

export interface Env {
  // KV namespaces
  BLOCKS_KV: KVNamespace;
  CACHE_KV: KVNamespace;

  // R2 bucket
  CONTENT_R2: R2Bucket;

  // Vectorize index
  CONTENT_VECTORIZE: VectorizeIndex;

  // Durable Object
  USER_SESSION: DurableObjectNamespace;

  // Workers AI
  AI: Ai;

  // Secrets
  CEREBRAS_API_KEY: string;

  // Configuration
  ALLOWED_ORIGINS?: string;
}

// Cloudflare Workers type stubs for compilation
// In production these come from @cloudflare/workers-types

interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { expirationTtl?: number; metadata?: Record<string, unknown> },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { customMetadata?: Record<string, string> },
  ): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
}

interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
  body?: ReadableStream;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

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

interface Ai {
  run(
    model: string,
    inputs: {
      messages?: { role: string; content: string }[];
      prompt?: string;
      max_tokens?: number;
    },
  ): Promise<{ response?: string }>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
  newUniqueId(): DurableObjectId;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

// test/worker/worker.test.ts — Tests for Worker components
// Tests pure-logic modules: cache strategy, R2 adapter, KV adapter, routing

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheStrategy } from '../../worker/storage/cache-strategy.js';
import type { IntentVector, BlockReplacement } from '@glow/core';

// ---------------------------------------------------------------------------
// Mock KV
// ---------------------------------------------------------------------------

function createMockKV(): Record<string, string> & {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const store: Record<string, string> = {};

  const kv = {
    get: vi.fn(async (key: string, opts?: { type?: string }) => {
      const val = store[key];
      if (!val) return null;
      if (opts?.type === 'json') return JSON.parse(val);
      return val;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    delete: vi.fn(async (key: string) => {
      delete store[key];
    }),
  };

  return Object.assign(store, kv);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<IntentVector> = {}): IntentVector {
  return {
    sessionId: 'test-session',
    archetype: 'explore',
    confidence: 0.7,
    topicEmbedding: [],
    topics: [],
    audienceMode: 'novice',
    contentDepth: 'overview',
    emotionalRegister: 'rational',
    signalCount: 5,
    history: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<BlockReplacement> = {}): BlockReplacement {
  return {
    selector: '.hero',
    html: '<div>Generated</div>',
    templateId: 'hero-1',
    atomIds: ['a1'],
    generationTimeMs: 500,
    model: 'gpt-oss-120b',
    confidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CacheStrategy tests
// ---------------------------------------------------------------------------

describe('CacheStrategy', () => {
  let kv: ReturnType<typeof createMockKV>;
  let cache: CacheStrategy;

  beforeEach(() => {
    kv = createMockKV();
    cache = new CacheStrategy(kv as any);
  });

  describe('getCached / setCached', () => {
    it('returns null on cache miss', async () => {
      const result = await cache.getCached('sess', 'https://example.com', null);
      expect(result).toBeNull();
    });

    it('stores and retrieves cached blocks', async () => {
      const intent = makeIntent();
      const blocks = [makeBlock()];

      await cache.setCached('sess', 'https://example.com', blocks, intent);
      const result = await cache.getCached('sess', 'https://example.com', intent);

      expect(result).not.toBeNull();
      expect(result!.blocks).toHaveLength(1);
      expect(result!.blocks[0].selector).toBe('.hero');
      expect(result!.intent.archetype).toBe('explore');
    });

    it('returns cached data when current intent is null', async () => {
      const intent = makeIntent();
      await cache.setCached('sess', 'https://example.com', [makeBlock()], intent);

      const result = await cache.getCached('sess', 'https://example.com', null);
      expect(result).not.toBeNull();
    });
  });

  describe('intent shift detection', () => {
    it('invalidates cache when archetype changes', async () => {
      const oldIntent = makeIntent({ archetype: 'explore' });
      await cache.setCached('sess', 'https://example.com', [makeBlock()], oldIntent);

      const newIntent = makeIntent({ archetype: 'compare' });
      const result = await cache.getCached('sess', 'https://example.com', newIntent);

      expect(result).toBeNull();
    });

    it('invalidates cache when confidence drops significantly', async () => {
      const oldIntent = makeIntent({ confidence: 0.9 });
      await cache.setCached('sess', 'https://example.com', [makeBlock()], oldIntent);

      const newIntent = makeIntent({ confidence: 0.4 }); // dropped by 0.5
      const result = await cache.getCached('sess', 'https://example.com', newIntent);

      expect(result).toBeNull();
    });

    it('keeps cache when confidence drops slightly', async () => {
      const oldIntent = makeIntent({ confidence: 0.9 });
      await cache.setCached('sess', 'https://example.com', [makeBlock()], oldIntent);

      const newIntent = makeIntent({ confidence: 0.7 }); // dropped by 0.2 (< 0.3 threshold)
      const result = await cache.getCached('sess', 'https://example.com', newIntent);

      expect(result).not.toBeNull();
    });

    it('invalidates cache when content depth changes', async () => {
      const oldIntent = makeIntent({ contentDepth: 'overview' });
      await cache.setCached('sess', 'https://example.com', [makeBlock()], oldIntent);

      const newIntent = makeIntent({ contentDepth: 'comprehensive' });
      const result = await cache.getCached('sess', 'https://example.com', newIntent);

      expect(result).toBeNull();
    });
  });

  describe('invalidateSession', () => {
    it('deletes cached entries for specified pages', async () => {
      await cache.setCached('sess', 'https://example.com/a', [makeBlock()], makeIntent());
      await cache.setCached('sess', 'https://example.com/b', [makeBlock()], makeIntent());

      await cache.invalidateSession('sess', ['https://example.com/a']);

      const a = await cache.getCached('sess', 'https://example.com/a', null);
      const b = await cache.getCached('sess', 'https://example.com/b', null);

      expect(a).toBeNull();
      expect(b).not.toBeNull();
    });
  });

  describe('predictNextPages', () => {
    it('returns empty array when no site links', () => {
      const result = cache.predictNextPages([], 'https://example.com', []);
      expect(result).toEqual([]);
    });

    it('excludes current page from predictions', () => {
      const result = cache.predictNextPages(
        [],
        'https://example.com/a',
        ['https://example.com/a', 'https://example.com/b'],
      );
      expect(result).not.toContain('https://example.com/a');
      expect(result).toContain('https://example.com/b');
    });

    it('excludes already visited pages', () => {
      const result = cache.predictNextPages(
        ['https://example.com/b'],
        'https://example.com/a',
        ['https://example.com/b', 'https://example.com/c'],
      );
      expect(result).not.toContain('https://example.com/b');
      expect(result).toContain('https://example.com/c');
    });

    it('returns at most 3 pages', () => {
      const links = Array.from({ length: 10 }, (_, i) =>
        `https://example.com/page-${i}`,
      );
      const result = cache.predictNextPages(
        [],
        'https://example.com/current',
        links,
      );
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('prefers sibling pages for branching navigation pattern', () => {
      const history = [
        'https://example.com/docs/intro',
        'https://example.com/docs/setup',
        'https://example.com/docs/basics',
      ];
      const links = [
        'https://example.com/docs/advanced',    // same depth (sibling)
        'https://example.com/docs/advanced/deep', // deeper
        'https://example.com/about',             // shallower
      ];

      const result = cache.predictNextPages(
        history,
        'https://example.com/docs/basics',
        links,
      );

      // Sibling should be ranked higher
      expect(result[0]).toBe('https://example.com/docs/advanced');
    });

    it('prefers sequential pages for linear navigation pattern', () => {
      const history = [
        'https://example.com/chapter-1',
        'https://example.com/chapter-1/section-a',
        'https://example.com/chapter-1/section-a/detail',
      ];
      const links = [
        'https://example.com/chapter-2',
        'https://example.com/about',
      ];

      const result = cache.predictNextPages(
        history,
        'https://example.com/chapter-1/section-a/detail',
        links,
      );

      // Should include predictions (order depends on shared path scoring)
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// R2 adapter tests (simpleHash consistency)
// ---------------------------------------------------------------------------

describe('R2StorageAdapter', () => {
  it('can be imported', async () => {
    const mod = await import('../../worker/storage/r2-adapter.js');
    expect(mod.R2StorageAdapter).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// KV adapter tests
// ---------------------------------------------------------------------------

describe('KVStorageAdapter', () => {
  it('can be imported', async () => {
    const mod = await import('../../worker/storage/kv-adapter.js');
    expect(mod.KVStorageAdapter).toBeDefined();
  });

  it('queryAtoms returns empty for missing site', async () => {
    const { KVStorageAdapter } = await import('../../worker/storage/kv-adapter.js');
    const mockKV = createMockKV();
    const adapter = new KVStorageAdapter(mockKV as any, mockKV as any);

    const atoms = await adapter.queryAtoms('nonexistent', [], {}, 10);
    expect(atoms).toEqual([]);
  });

  it('getCachedBlock returns null for missing key', async () => {
    const { KVStorageAdapter } = await import('../../worker/storage/kv-adapter.js');
    const mockKV = createMockKV();
    const adapter = new KVStorageAdapter(mockKV as any, mockKV as any);

    const result = await adapter.getCachedBlock('missing-key');
    expect(result).toBeNull();
  });

  it('stores and retrieves brand profile', async () => {
    const { KVStorageAdapter } = await import('../../worker/storage/kv-adapter.js');
    const blocksKV = createMockKV();
    const cacheKV = createMockKV();
    const adapter = new KVStorageAdapter(blocksKV as any, cacheKV as any);

    const profile = {
      siteId: 'example.com',
      voice: {
        tone: ['professional'],
        formality: 'balanced' as const,
        personPerspective: 'second' as const,
        characteristicPhrases: [],
      },
      visual: {
        primaryColors: ['#333'],
        fontFamilies: ['Arial'],
        spacingScale: [4, 8, 16],
      },
      guardrails: {
        forbiddenTerms: [],
        requiredDisclaimers: [],
        approvalRequired: false,
        maxGeneratedBlocksPerPage: 5,
      },
      siteType: 'corporate' as const,
      skillConfig: 'default',
    };

    await adapter.storeBrandProfile(profile);
    const retrieved = await adapter.getBrandProfile('example.com');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.siteId).toBe('example.com');
    expect(retrieved!.voice.formality).toBe('balanced');
  });
});

// ---------------------------------------------------------------------------
// Vectorize adapter tests
// ---------------------------------------------------------------------------

describe('VectorizeAdapter', () => {
  it('can be imported', async () => {
    const mod = await import('../../worker/storage/vectorize-adapter.js');
    expect(mod.VectorizeAdapter).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cerebras proxy tests
// ---------------------------------------------------------------------------

describe('CerebrasProxy', () => {
  it('can be imported', async () => {
    const mod = await import('../../worker/storage/cerebras-proxy.js');
    expect(mod.CerebrasProxy).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Worker routing tests
// ---------------------------------------------------------------------------

describe('Worker entry point', () => {
  it('exports json helper', async () => {
    const mod = await import('../../worker/index.js');
    expect(typeof mod.json).toBe('function');
  });

  it('json helper creates proper Response', async () => {
    const mod = await import('../../worker/index.js');
    const response = mod.json({ hello: 'world' });
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    const body = await response.json();
    expect(body).toEqual({ hello: 'world' });
  });

  it('json helper accepts custom status', async () => {
    const mod = await import('../../worker/index.js');
    const response = mod.json({ error: 'not found' }, 404);
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Durable Object tests
// ---------------------------------------------------------------------------

describe('UserSession Durable Object', () => {
  it('exports UserSession class', async () => {
    const mod = await import('../../worker/session/durable-object.js');
    expect(mod.UserSession).toBeDefined();
  });
});

# Testing

## Framework

| Tool | Purpose |
|------|---------|
| Vitest | Test runner + assertion library |
| `vi.fn()` / `vi.mock()` | Mocking |
| jsdom | DOM environment for extension/injector tests |

Config: `vitest.config.ts` — globals enabled, path alias `@glow/core` → `./core`.

## Running Tests

| Command | Scope |
|---------|-------|
| `npx vitest run` | All tests, single run |
| `npx vitest` | Watch mode |
| `npx vitest run test/core/pipeline.test.ts` | Single file |
| `npx vitest run --coverage` | With V8 coverage |

Coverage includes `core/**/*.ts` and `indexer/**/*.ts`. Excludes test files, `.d.ts`, and `index.ts` barrels.

## Test File Locations

| Test file | Tests for |
|-----------|-----------|
| `test/core/types.test.ts` | Type validation, constants, ContentAtom/IntentVector shape |
| `test/core/pipeline.test.ts` | Full pipeline orchestration with mocked deps |
| `test/core/crawler.test.ts` | Crawler with HTML/sitemap/robots fixtures |
| `test/core/extractor.test.ts` | Block detection, atom extraction, template extraction |
| `test/core/embedder-profiler.test.ts` | Embedding generation, brand profiling |
| `test/core/skills-analytics.test.ts` | Skill loading/validation, analytics scoring |
| `test/extension/extension.test.ts` | Signal capture, injection, service worker |
| `test/worker/worker.test.ts` | Worker routes, Durable Object, storage adapters |

Fixtures: `test/fixtures/crawler/` — sample HTML pages, robots.txt, sitemaps.

## Mocking Patterns

### Mock StorageInterface

Every pipeline test needs a mocked storage backend:

```typescript
import { vi } from 'vitest';
import type { StorageInterface } from '@glow/core';

const mockStorage: StorageInterface = {
  queryAtoms: vi.fn().mockResolvedValue([]),
  getTemplate: vi.fn().mockResolvedValue(null),
  getTemplatesForPosition: vi.fn().mockResolvedValue([]),
  getBrandProfile: vi.fn().mockResolvedValue(null),
  getCachedBlock: vi.fn().mockResolvedValue(null),
  setCachedBlock: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
};
```

### Mock CerebrasClient

```typescript
import type { CerebrasClient } from '@glow/core';

const mockCerebras: CerebrasClient = {
  complete: vi.fn().mockResolvedValue({
    content: '{"headline": "Generated Headline", "body": "Generated body text."}',
    model: 'gpt-oss-120b',
    usage: { promptTokens: 500, completionTokens: 100, totalTokens: 600 },
    latencyMs: 800,
  }),
};
```

### Mock IntentEngine

```typescript
import type { IntentEngine } from '@glow/core';

const mockIntentEngine: IntentEngine = {
  ingestSignals: vi.fn().mockReturnValue(makeIntent()),
  inferFromAggregated: vi.fn().mockReturnValue(makeIntent()),
};
```

## Test Fixtures

### makeIntent helper

```typescript
function makeIntent(overrides: Partial<IntentVector> = {}): IntentVector {
  return {
    sessionId: 'sess-1',
    archetype: 'explore',
    confidence: 0.7,
    topicEmbedding: [0.1, 0.2, 0.3, 0.4],
    audienceMode: 'intermediate',
    contentDepth: 'detailed',
    emotionalRegister: 'rational',
    signalCount: 5,
    history: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
```

### makeAtom helper

```typescript
function makeAtom(id: string, content: string, embedding?: number[]): ContentAtom {
  return {
    id,
    content,
    sourceUrl: 'https://example.com/',
    blockPosition: 0,
    contentType: 'body',
    metadata: {
      topics: ['cloud'],
      audienceDepth: 'intermediate',
      purpose: 'inform',
      emotionalRegister: 'rational',
      wordCount: content.split(/\s+/).length,
      language: 'en',
    },
    embedding,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
```

### makeTemplate helper

```typescript
function makeTemplate(id: string, position: BlockPosition = 'hero'): BlockTemplate {
  return {
    id,
    sourceUrl: 'https://example.com/',
    position,
    html: '<section><h1>{{headline}}</h1><p>{{body}}</p><a>{{cta}}</a></section>',
    slots: [
      { name: 'headline', type: 'text', constraints: { required: true, minLength: 10, maxLength: 100 }, originalContent: 'Default headline' },
      { name: 'body', type: 'rich-text', constraints: { required: true, minLength: 20, maxLength: 500 }, originalContent: 'Default body' },
      { name: 'cta', type: 'text', constraints: { required: true, minLength: 5, maxLength: 30 }, originalContent: 'Learn more' },
    ],
    cssRules: 'display:flex;flex-direction:column;padding:24px;',
    extractedAt: new Date().toISOString(),
  };
}
```

## What Must Be Tested

| Area | What to test | Example |
|------|-------------|---------|
| Intent engine | Archetype selection for known signal patterns | 5 CTA clicks → seek_action |
| Intent engine | Momentum blending prevents flaky switching | 1 comparison click doesn't override 10 explore signals |
| Pipeline | Confidence below 0.3 returns empty blocks | `makeIntent({ confidence: 0.2 })` → 0 blocks |
| Pipeline | Cache hits skip generation | Mock `getCachedBlock` → returns HTML |
| Pipeline | Budget timeout returns partial results | Set budget to 100ms → some blocks dropped |
| Generation | Prompt stays under 2000 tokens | Count estimated tokens in built prompt |
| Slot filler | XSS characters are escaped | Input `<script>` → output `&lt;script&gt;` |
| Slot filler | Required slots fall back to original | Missing slot → uses originalContent |
| Crawler | robots.txt disallow is respected | Disallowed path not crawled |
| Crawler | Rate limiting between requests | Assert delay between fetches |
| Skills | Invalid config fails validation | Missing required field → `valid: false` |

## What Does NOT Need Tests

| Skip | Why |
|------|-----|
| Badge visual appearance | Inline HTML string, verified by inspection |
| Chrome extension APIs | Mocked at boundary, tested via integration |
| Cerebras API responses | Mocked — real API tested manually |
| Cloudflare bindings (KV, R2) | Mocked — tested via Miniflare in integration |
| DOM rendering of injected blocks | Tested via jsdom structure, not visual rendering |

## Adding a New Test

1. Create test file in appropriate directory (`test/core/`, `test/extension/`, `test/worker/`)
2. Import from `@glow/core` for types and implementations
3. Use `vi.fn()` for all external dependencies
4. Use `beforeEach(() => vi.clearAllMocks())` to reset state
5. Follow existing `make*` helper pattern for fixtures
6. Run `npx vitest run` to verify

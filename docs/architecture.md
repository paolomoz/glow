# Architecture

## System Overview

Glow injects AI-generated content blocks into any website in real time. Three deployment modes share the same core pipeline:

| Mode | Client | Backend | Storage |
|------|--------|---------|---------|
| Demo | Chrome Extension | Extension service worker | IndexedDB |
| Production | JS Snippet (`<script>` tag) | Cloudflare Worker | KV + R2 + Vectorize |
| Indexing | CLI (Node.js) | Direct Cerebras API | Local / R2 |

## Pipeline Flow

```
Signal → Normalize → Aggregate → Intent Engine → Confidence Check
  → Cache Lookup → Retrieve Atoms → Rank & Select → Generate (Cerebras)
  → Fill Slots → Assemble HTML → Inject into DOM
```

| Stage | Budget Target | Module |
|-------|--------------|--------|
| Signal → Intent | <100ms | `core/intent/engine.ts` |
| Cache hit | ~400ms total | `core/pipeline/orchestrator.ts` |
| Retrieve + Rank | ~200ms | `core/retrieval/atom-selector.ts` |
| Generate (GPT-OSS-120B) | ~1,200ms | `core/generation/cerebras-client.ts` |
| Generate (GLM-4.7) | ~800ms | `core/generation/cerebras-client.ts` |
| Assemble + Inject | ~50ms | `core/blocks/assembler.ts` |
| **Hard timeout** | **2,500ms** | `core/pipeline/timeout.ts` |

## Source Tree

```
glow/
├── core/                          # Pure TypeScript, zero platform deps
│   ├── types.ts                   # ALL shared types and constants
│   ├── index.ts                   # Barrel export
│   ├── intent/
│   │   ├── engine.ts              # DefaultIntentEngine — rules + dot product scoring
│   │   ├── signals.ts             # SignalNormalizer, SignalAggregator, pattern regexes
│   │   ├── archetypes.ts          # 5 archetype profiles with 6D feature weights
│   │   └── progressive.ts         # Confidence → personalization level mapping
│   ├── retrieval/
│   │   ├── interfaces.ts          # StorageInterface re-export
│   │   ├── query-builder.ts       # Intent → retrieval query translation
│   │   └── atom-selector.ts       # Atom scoring: semantic + intent + freshness + perf
│   ├── generation/
│   │   ├── cerebras-client.ts     # HTTP client for Cerebras API (non-streaming)
│   │   ├── model-router.ts        # Task → model selection with budget awareness
│   │   ├── prompt-builder.ts      # Prompt assembly with token budget enforcement
│   │   └── templates/
│   │       ├── content-fill.ts    # Slot-filling prompt template
│   │       ├── layout-adapt.ts    # HTML generation prompt template
│   │       └── compliance.ts      # Brand guardrail check template
│   ├── blocks/
│   │   ├── registry.ts            # In-memory block template storage
│   │   ├── slot-filler.ts         # {{slot}} replacement with XSS escaping
│   │   ├── assembler.ts           # Template + slots + CSS → final HTML
│   │   └── badge.ts               # AI provenance badge (✦ icon)
│   ├── pipeline/
│   │   ├── orchestrator.ts        # Full pipeline: signal → HTML
│   │   ├── speculative.ts         # Pre-generation for predicted next pages
│   │   └── timeout.ts             # TimeBudget class with AbortSignal
│   ├── analytics/
│   │   ├── tracker.ts             # Engagement event collection
│   │   ├── scorer.ts              # Content atom performance scoring
│   │   └── gaps.ts                # Gap analysis (unserved intents)
│   └── skills/
│       ├── loader.ts              # Skill config loading + defaults
│       ├── classifier.ts          # Auto-classify site type during indexing
│       ├── validator.ts           # JSON schema validation for skill configs
│       └── hot-loader.ts          # Runtime skill reloading from KV
│
├── indexer/                       # Site → Content Index pipeline
│   ├── crawler.ts                 # Sitemap + BFS crawl, robots.txt, rate limiting
│   ├── fetcher.ts                 # HTTP fetcher with 15s timeout, 5MB cap
│   ├── robots.ts                  # robots.txt parser
│   ├── sitemap.ts                 # Sitemap XML/index parser
│   ├── url-utils.ts               # URL normalization and deduplication
│   ├── extractor/
│   │   ├── index.ts               # Extraction orchestrator
│   │   ├── block-detector.ts      # DOM heuristic block boundary detection
│   │   ├── atom-extractor.ts      # Content → atoms (headlines, body, CTAs, etc.)
│   │   ├── template-extractor.ts  # HTML shell + {{slot}} + computed CSS capture
│   │   ├── structured-data.ts     # JSON-LD, OpenGraph, microdata extraction
│   │   └── visual-capture.ts      # Block-level screenshot capture
│   ├── chunker.ts                 # Atom → embedding-sized chunks (256-512 tokens)
│   ├── embedder.ts                # BGE-large-en-v1.5 embedding generation
│   ├── profiler.ts                # Brand voice extraction (LLM or heuristic)
│   ├── index-builder.ts           # Full index orchestration
│   └── storage-writers.ts         # Write index to storage backends
│
├── extension/                     # Chrome Extension (Manifest V3)
│   ├── manifest.json              # Permissions: activeTab, scripting, storage, sidePanel
│   ├── content-script/
│   │   ├── index.ts               # Entry point
│   │   ├── signals.ts             # DOM event → Signal capture (10 signal types)
│   │   ├── injector.ts            # Block injection with crossfade + toggle
│   │   ├── observer.ts            # MutationObserver for SPA navigation
│   │   └── batcher.ts             # Signal batching (500ms interval)
│   ├── background/
│   │   ├── service-worker.ts      # Pipeline orchestration, message routing
│   │   ├── session.ts             # Per-tab session state
│   │   └── messages.ts            # Message type definitions
│   ├── panel/
│   │   ├── panel.html             # Debug side panel
│   │   ├── panel.ts               # Panel controller
│   │   └── components/            # IntentMeter, SignalLog, BlockMap, TimingBreakdown
│   └── storage/
│       └── indexeddb-adapter.ts   # StorageInterface → IndexedDB
│
├── worker/                        # Cloudflare Worker (production)
│   ├── index.ts                   # Route handler: /signals, /blocks, /index, /analytics
│   ├── env.ts                     # Env type: KV, R2, Vectorize, DO, AI bindings
│   ├── wrangler.toml              # Worker config
│   ├── routes/
│   │   ├── signals.ts             # POST /signals → Durable Object
│   │   ├── blocks.ts              # GET /blocks → orchestrator.process()
│   │   ├── index-route.ts         # POST /index (stub — pending implementation)
│   │   └── analytics.ts           # POST /analytics → R2
│   ├── session/
│   │   └── durable-object.ts      # Per-user intent state, 30s TTL, alarm-based expiry
│   └── storage/
│       ├── kv-adapter.ts          # KV: templates, profiles, cached blocks, atoms
│       ├── r2-adapter.ts          # R2: raw HTML corpus, analytics events
│       ├── vectorize-adapter.ts   # Vectorize: atom vector search
│       ├── cache-strategy.ts      # Speculative cache + intent-shift invalidation
│       └── cerebras-proxy.ts      # Cerebras API proxy with key injection
│
├── snippet/                       # Production JS tag
│   ├── loader.ts                  # Signal collection, block injection, consent detection
│   └── vite.config.ts             # Build config (target: <5KB gzipped)
│
├── skills/                        # Website-type JSON configs
│   ├── _schema.json               # JSON Schema for validation
│   ├── pharma.json                # HCP/patient detection, ISI, disclaimers
│   ├── ecommerce.json             # Purchase intent, product comparison
│   ├── saas.json                  # Buyer stage, feature vs pricing
│   └── media.json                 # Content consumption depth
│
├── test/
│   ├── core/                      # Unit tests (vitest + vi mocks)
│   │   ├── types.test.ts          # Type validation and constants
│   │   ├── crawler.test.ts        # Crawler with HTML fixtures
│   │   ├── embedder-profiler.test.ts
│   │   ├── extractor.test.ts
│   │   ├── pipeline.test.ts       # Full pipeline with mocked Cerebras
│   │   └── skills-analytics.test.ts
│   ├── extension/
│   │   └── extension.test.ts
│   ├── worker/
│   │   └── worker.test.ts
│   └── fixtures/
│       └── crawler/               # Sample HTML, robots.txt, sitemaps
│
├── improvements/                  # Tracked improvement opportunities
│   ├── intent-engine.md
│   ├── pipeline-generation.md
│   └── indexer-worker.md
│
└── docs/                          # This documentation
```

## File-Finding Guide

### I need to change how intent is inferred...

| Goal | Modify |
|------|--------|
| Add a new signal type | `core/intent/signals.ts` (SignalNormalizer + SignalAggregator) |
| Change archetype definitions | `core/intent/archetypes.ts` (ARCHETYPE_PROFILES) |
| Adjust confidence scoring | `core/intent/engine.ts` (inferFromAggregated) |
| Change personalization thresholds | `core/intent/progressive.ts` + `core/types.ts` constants |
| Add a new feature dimension | `core/intent/engine.ts` (extractFeatures) + `core/intent/archetypes.ts` |

### I need to change content retrieval...

| Goal | Modify |
|------|--------|
| Change how intent maps to queries | `core/retrieval/query-builder.ts` (ARCHETYPE_PURPOSE_MAP) |
| Adjust atom scoring weights | `core/retrieval/atom-selector.ts` (DEFAULT_WEIGHTS) |
| Change freshness decay | `core/retrieval/atom-selector.ts` (freshness function) |
| Add a new storage backend | Implement `StorageInterface` from `core/types.ts` |

### I need to change content generation...

| Goal | Modify |
|------|--------|
| Change model routing | `core/generation/model-router.ts` (DEFAULT_MODEL_MAP) |
| Adjust prompt templates | `core/generation/templates/*.ts` |
| Change token budget | `core/generation/prompt-builder.ts` (MAX_INPUT_TOKENS) |
| Add streaming support | `core/generation/cerebras-client.ts` |
| Add a new generation task | `core/types.ts` (GenerationTask) + `core/generation/model-router.ts` + new template |

### I need to change block assembly...

| Goal | Modify |
|------|--------|
| Change slot replacement logic | `core/blocks/slot-filler.ts` |
| Modify AI badge appearance | `core/blocks/badge.ts` |
| Change HTML wrapping | `core/blocks/assembler.ts` |
| Add a new slot type | `core/types.ts` (SlotType) + `core/blocks/slot-filler.ts` |

### I need to change the Worker...

| Goal | Modify |
|------|--------|
| Add a new API route | `worker/index.ts` + new file in `worker/routes/` |
| Change session behavior | `worker/session/durable-object.ts` |
| Modify cache strategy | `worker/storage/cache-strategy.ts` |
| Change storage key schema | `worker/storage/kv-adapter.ts` or `r2-adapter.ts` |
| Update Worker bindings | `worker/wrangler.toml` + `worker/env.ts` |

### I need to change the extension...

| Goal | Modify |
|------|--------|
| Add a new signal type (capture) | `extension/content-script/signals.ts` |
| Change block injection behavior | `extension/content-script/injector.ts` |
| Add a debug panel component | `extension/panel/components/` + `extension/panel/panel.ts` |
| Change extension permissions | `extension/manifest.json` |

### I need to change indexing...

| Goal | Modify |
|------|--------|
| Change crawl behavior | `indexer/crawler.ts` |
| Modify content extraction | `indexer/extractor/atom-extractor.ts` or `block-detector.ts` |
| Change embedding model | `indexer/embedder.ts` |
| Adjust chunking strategy | `indexer/chunker.ts` |
| Modify brand profiling | `indexer/profiler.ts` |

## Data Flow: Signal to HTML

```
1. User clicks on page
   ↓
2. extension/content-script/signals.ts captures click_target signal
   ↓
3. extension/content-script/batcher.ts batches signals (500ms)
   ↓
4. extension/background/service-worker.ts receives SIGNAL_BATCH message
   ↓
5. core/intent/signals.ts normalizes + aggregates
   ↓
6. core/intent/engine.ts extracts 6D feature vector, scores against archetypes
   ↓
7. core/pipeline/orchestrator.ts checks confidence >= 0.3
   ↓
8. core/retrieval/query-builder.ts maps intent → retrieval query
   ↓
9. StorageInterface.queryAtoms() returns candidate atoms
   ↓
10. core/retrieval/atom-selector.ts ranks atoms (semantic + intent + freshness + perf)
    ↓
11. core/generation/model-router.ts picks model within remaining budget
    ↓
12. core/generation/prompt-builder.ts assembles prompt (<2000 tokens)
    ↓
13. core/generation/cerebras-client.ts calls Cerebras API
    ↓
14. core/blocks/slot-filler.ts fills {{slots}} with XSS escaping
    ↓
15. core/blocks/assembler.ts wraps with inline CSS + AI badge
    ↓
16. extension/content-script/injector.ts injects with 200ms crossfade
```

## Key Interfaces

### StorageInterface (`core/types.ts`)

All storage backends implement this contract:

```typescript
interface StorageInterface {
  queryAtoms(siteId: string, embedding: number[], filters: Partial<ContentMetadata>, limit: number): Promise<ContentAtom[]>;
  getTemplate(siteId: string, templateId: string): Promise<BlockTemplate | null>;
  getTemplatesForPosition(siteId: string, position: BlockPosition): Promise<BlockTemplate[]>;
  getBrandProfile(siteId: string): Promise<BrandProfile | null>;
  getCachedBlock(key: string): Promise<string | null>;
  setCachedBlock(key: string, html: string, ttlSeconds: number): Promise<void>;
  logEvent(event: AnalyticsEvent): Promise<void>;
}
```

Implementations:
- `extension/storage/indexeddb-adapter.ts` — Extension (demo mode)
- `worker/storage/kv-adapter.ts` + `vectorize-adapter.ts` — Worker (production)

### IntentEngine (`core/intent/engine.ts`)

```typescript
interface IntentEngine {
  ingestSignals(currentIntent: IntentVector | null, signals: Signal[]): IntentVector;
  inferFromAggregated(currentIntent: IntentVector | null, aggregated: AggregatedSignals, sessionId: string): IntentVector;
}
```

### Orchestrator (`core/pipeline/orchestrator.ts`)

```typescript
interface Orchestrator {
  process(siteId: string, sessionId: string, pageUrl: string, signals: Signal[]): Promise<PipelineResult>;
}
```

### CerebrasClient (`core/generation/cerebras-client.ts`)

```typescript
interface CerebrasClient {
  complete(request: CompletionRequest, abortSignal?: AbortSignal): Promise<CompletionResponse>;
}
```

# Generative Web Overlay — Implementation Plan

## Project Codename: **Glow** (Generative Layer Over Web)

### Mission

Make any website generative in minutes. Inject real-time, intent-driven personalized content into any existing website — no migration, no CMS change, no code access required. Progressive personalization: the longer you browse, the more the site adapts to you. Sub-2.5s click-to-LCP for all generative content.

-----

## Architecture Summary

### Three Deployment Modes

- **Demo (Chrome Extension):** Zero infrastructure. Extension + Cerebras API key. Works on any website instantly. Debug panel shows intent, signals, content provenance.
- **Production (JS Snippet + Cloudflare Workers):** Website owner adds a `<script>` tag. Full edge infrastructure with speculative pre-generation, session persistence, analytics.
- **Vanilla (Phase 2):** Brand owns a structured content repository. Closed learning loop. Content authors work through agents (SLICC-based).

### Inference Stack

- **Cerebras** as primary inference provider
  - **GPT-OSS-120B** (~3,000 tok/s): Content generation — headlines, body, CTAs
  - **GLM-4.7** (~1,000-1,700 tok/s): Layout-aware generation — HTML block composition, template adaptation, UI-quality output
  - **GLM-4.7-Flash** (30B MoE, ~80 tok/s local or fast via API): Lightweight tasks — atom selection, compliance checks, intent refinement
- **Workers AI** (Llama 3.3 8B): Fallback only, when Cerebras is unavailable

### Intent Engine

- **No LLM in the hot path.** Rules-based signal processing + embedding similarity against pre-computed intent archetypes. Sub-100ms at the edge.
- Background async refinement via GLM-4.7-Flash for complex intent patterns.

### Time Budget (click → LCP)

|Path                     |Target   |Mechanism                   |
|-------------------------|---------|----------------------------|
|Cache hit (pre-generated)|~400ms   |KV read → inject            |
|On-demand, content fill  |~1,200ms |Retrieve → GPT-OSS → inject |
|On-demand, layout adapt  |~1,500ms |Retrieve → GLM-4.7 → inject |
|Fallback (Workers AI)    |~2,200ms |Retrieve → Llama 8B → inject|
|Hard timeout             |0ms delta|Show original page unchanged|

-----

## Project Structure

```
glow/
├── core/                          # Shared pipeline logic (pure TypeScript, no platform deps)
│   ├── pipeline/
│   │   ├── orchestrator.ts        # Signal → Intent → Retrieve → Generate → Assemble
│   │   ├── speculative.ts         # Pre-generation for predicted next pages
│   │   └── timeout.ts             # Hard 2.5s budget enforcement
│   ├── intent/
│   │   ├── signals.ts             # Signal type definitions and normalization
│   │   ├── engine.ts              # Rules-based intent inference, confidence scoring
│   │   ├── archetypes.ts          # Pre-computed intent archetypes (explore, compare, dive, act, return)
│   │   └── progressive.ts         # Confidence thresholds for personalization levels
│   ├── retrieval/
│   │   ├── query-builder.ts       # Intent vector → retrieval query translation
│   │   ├── atom-selector.ts       # Content atom ranking and selection
│   │   └── interfaces.ts          # Storage-agnostic retrieval interface
│   ├── generation/
│   │   ├── cerebras-client.ts     # Cerebras API wrapper (streaming + non-streaming)
│   │   ├── model-router.ts        # Task → model selection logic
│   │   ├── prompt-builder.ts      # Assemble prompts from brand brief + intent + template + atoms
│   │   └── templates/
│   │       ├── content-fill.ts    # Prompt template for filling existing block slots
│   │       ├── layout-adapt.ts    # Prompt template for GLM-4.7 layout generation
│   │       └── compliance.ts      # Prompt template for brand guardrail checking
│   ├── blocks/
│   │   ├── registry.ts            # Block template storage and lookup
│   │   ├── slot-filler.ts         # Map generated content into template slots
│   │   ├── assembler.ts           # Produce final HTML from filled template
│   │   └── badge.ts               # AI provenance badge injection (✦ icon)
│   ├── analytics/
│   │   ├── tracker.ts             # Engagement event collection
│   │   ├── scorer.ts              # Content atom performance scoring
│   │   └── gaps.ts                # Gap analysis — intent signals without good content matches
│   ├── skills/
│   │   ├── loader.ts              # Load and apply website-type skill configs
│   │   └── classifier.ts          # Auto-classify site type during indexing
│   └── types.ts                   # All shared type definitions
│
├── indexer/                        # Site → Content Index pipeline
│   ├── crawler.ts                 # Sitemap discovery + breadth-first page crawl
│   ├── extractor/
│   │   ├── content.ts             # Text, headings, images, metadata, structured data
│   │   ├── blocks.ts              # DOM block boundary detection + HTML shell extraction
│   │   ├── styles.ts              # Computed CSS capture for block templates
│   │   └── screenshots.ts         # Block-level visual capture for classification
│   ├── embedder.ts                # Content chunking + embedding generation
│   ├── profiler.ts                # Brand voice extraction, site type classification
│   └── index-builder.ts           # Orchestrate full index build, output to storage
│
├── extension/                      # Chrome Extension (demo mode)
│   ├── manifest.json
│   ├── content-script/
│   │   ├── signals.ts             # DOM event listeners for behavioral signals
│   │   ├── injector.ts            # Block replacement + AI badge in live DOM
│   │   └── observer.ts            # MutationObserver for SPA navigation detection
│   ├── background/
│   │   ├── service-worker.ts      # Pipeline orchestration, Cerebras calls
│   │   ├── session.ts             # Intent state in extension storage
│   │   └── cache.ts               # Pre-generated block cache (chrome.storage)
│   ├── panel/
│   │   ├── panel.html             # Side panel shell
│   │   ├── panel.tsx              # Debug UI — intent, signals, content map, timing
│   │   └── components/
│   │       ├── IntentMeter.tsx     # Confidence visualization
│   │       ├── SignalLog.tsx       # Real-time signal stream
│   │       ├── BlockMap.tsx        # Page overlay showing original vs generative blocks
│   │       └── TimingBreakdown.tsx # Per-block latency waterfall
│   └── storage/
│       └── indexeddb-adapter.ts   # Implements core retrieval interfaces via IndexedDB
│
├── worker/                         # Cloudflare Worker (production mode)
│   ├── index.ts                   # Main Worker entry — route handler
│   ├── routes/
│   │   ├── signals.ts             # POST /signals — ingest behavioral signals
│   │   ├── blocks.ts              # GET /blocks — return generated blocks for a page
│   │   ├── index.ts               # POST /index — trigger site indexing
│   │   └── analytics.ts          # POST /analytics — engagement events
│   ├── session/
│   │   └── durable-object.ts     # Per-user session state (intent, history, confidence)
│   ├── storage/
│   │   ├── kv-adapter.ts          # KV for block template cache, pre-generated blocks
│   │   ├── vectorize-adapter.ts   # Vectorize for content atom retrieval
│   │   ├── r2-adapter.ts          # R2 for raw content corpus, brand profiles
│   │   └── cache-strategy.ts      # Speculative pre-generation + TTL management
│   └── wrangler.toml              # Worker config — bindings for KV, R2, Vectorize, DO, AI
│
├── snippet/                        # Production JS snippet (what website owners embed)
│   ├── glow.min.js                # Signal collection + block injection (<5KB gzipped)
│   └── loader.ts                  # Async load, init, connect to Worker
│
├── skills/                         # Website-type configuration files
│   ├── pharma.json                # HCP vs patient detection, ISI requirements, disclaimers
│   ├── ecommerce.json             # Purchase intent signals, product comparison patterns
│   ├── saas.json                  # Buyer stage inference, feature-vs-pricing signals
│   ├── media.json                 # Content consumption depth patterns
│   └── _schema.json               # JSON Schema for skill config validation
│
├── test/
│   ├── core/                      # Unit tests for pipeline, intent, retrieval, generation
│   ├── integration/               # End-to-end pipeline tests with mocked Cerebras
│   └── fixtures/                  # Sample site content indexes for testing
│
├── package.json                   # Monorepo root
├── tsconfig.json                  # Shared TypeScript config
├── vitest.config.ts               # Test configuration
└── README.md
```

-----

## Implementation Phases

### Phase 1: Foundation + Indexer (Weeks 1-2)

**Goal:** Given a URL, produce a complete content index (atoms, block templates, brand profile, embeddings) stored in R2/KV/Vectorize. This is the "minutes to generative" promise.

#### 1.1 — Project Scaffold [Claude Code]

Set up monorepo with workspaces for core, indexer, extension, worker, snippet. TypeScript strict mode. Vitest for testing. Wrangler for Worker development. Vite for extension bundling.

```
Tasks:
  CC-1.1.1  Initialize monorepo (package.json workspaces, tsconfig paths)
  CC-1.1.2  Set up build pipeline: Vite for extension, Wrangler for worker, tsc for core
  CC-1.1.3  Configure Vitest with coverage
  CC-1.1.4  Create core/types.ts — all shared type definitions (see appendix)
  CC-1.1.5  Scaffold empty modules with interface stubs for all core/ packages
  CC-1.1.6  Set up Cerebras client with API key management (env vars + extension storage)
```

#### 1.2 — Core Types + Interfaces [Claude Code]

Define the data contracts that all components build against. This is the most critical design step — get the types right and everything else follows.

```
Tasks:
  CC-1.2.1  ContentAtom type — text, metadata (topic, audience, depth, purpose, register),
            performance metrics, version history
  CC-1.2.2  BlockTemplate type — HTML shell string, slot definitions (name, type, constraints),
            CSS rules, responsive breakpoints, source page URL
  CC-1.2.3  BrandProfile type — voice characteristics, color palette, typography,
            terminology rules, guardrails (forbidden terms, required disclaimers)
  CC-1.2.4  IntentVector type — topic embedding, audience mode (explore/compare/dive/act/return),
            content depth, confidence score, signal history
  CC-1.2.5  Signal types — PageVisit, ScrollDepth, ClickTarget, HoverDwell, SearchQuery,
            FilterSelection, NavigationPath, TimeOnSection
  CC-1.2.6  GenerationRequest/Response types — template + atoms + intent + brand → filled HTML
  CC-1.2.7  StorageInterface — abstract interface for retrieval (implemented by IndexedDB
            adapter and Vectorize adapter)
  CC-1.2.8  SkillConfig type — signal weight overrides, guardrail rules, intent mapping
            customizations, generation constraints
```

#### 1.3 — Site Crawler [Claude Code]

Pure TypeScript crawler that discovers pages via sitemap.xml + breadth-first link following. Outputs raw HTML for each page. Runs as a Worker (production) or standalone script (dev).

```
Tasks:
  CC-1.3.1  Sitemap parser (XML sitemap, sitemap index, robots.txt sitemap discovery)
  CC-1.3.2  Breadth-first crawler with configurable depth limit and page cap (default: 50 pages)
  CC-1.3.3  Rate limiting and politeness (respect robots.txt crawl-delay)
  CC-1.3.4  HTML fetcher with proper User-Agent, redirect following, error handling
  CC-1.3.5  Deduplication (normalize URLs, skip fragments/query params)
  CC-1.3.6  Output: array of {url, html, statusCode, headers} for downstream processing
  CC-1.3.7  Tests with fixture HTML files
```

#### 1.4 — Content Extractor [SLICC — browser-native]

This is where SLICC earns its place. The extractor needs to work against rendered DOM, not raw HTML. Computed styles, layout positions, visual block boundaries — these require a real browser.

```
Tasks:
  SLICC-1.4.1  Block boundary detector — heuristic identification of discrete content sections
               in a rendered page. Use DOM tree depth changes, semantic elements (section, article,
               aside, header), visual gap analysis (margin/padding thresholds), and background
               color boundaries. Output: array of DOM ranges representing blocks.
  SLICC-1.4.2  Block template extractor — for each detected block, capture:
               - Outer HTML with content replaced by slot placeholders ({{headline}}, {{body}}, etc.)
               - Computed CSS for the block and all children (getComputedStyle, not stylesheet rules)
               - Slot schema: inferred from content (text nodes → string slots, img → image slots,
                 a → link slots) with character count constraints from the original content
               - Responsive behavior: capture at 3 viewport widths (mobile/tablet/desktop)
  SLICC-1.4.3  Content atom extractor — for each block, decompose content into atoms:
               - Headlines, subheadings, body paragraphs, CTAs, image alt text, list items
               - Each atom tagged with: source URL, block position, content type, word count
               - Preserve hierarchy (this heading belongs to this section)
  SLICC-1.4.4  Structured data extractor — JSON-LD, OpenGraph, meta tags, schema.org markup
  SLICC-1.4.5  Visual block capture — screenshot each detected block for classification
               (used by profiler to understand block types visually)
  SLICC-1.4.6  Test against 5 diverse sites: a pharma site, an e-commerce product page,
               a SaaS marketing page, a news article, a corporate homepage
```

**SLICC → Claude Code handoff:** The extraction code developed in SLICC gets committed to `indexer/extractor/`. It must work both in-browser (extension demo) and in a headless context (Worker with Browser Rendering for production indexing). Use the DOM API directly; avoid SLICC-specific VFS or tool dependencies.

#### 1.5 — Embedder + Profiler [Claude Code]

Take extracted content atoms, generate embeddings, classify the site type, extract brand profile.

```
Tasks:
  CC-1.5.1  Content chunker — split atoms into embedding-sized chunks (256-512 tokens),
            preserve metadata linkage
  CC-1.5.2  Embedding generator — call Cerebras/Workers AI embedding model, batch processing
  CC-1.5.3  Brand profiler — single LLM call (GPT-OSS) against representative content sample:
            extract voice characteristics, tone, terminology, audience segments, visual language
  CC-1.5.4  Site type classifier — rule-based first pass (pharma indicators: drug names, ISI,
            prescribing info; ecommerce: product pages, add-to-cart; SaaS: pricing pages,
            feature lists) + LLM confirmation
  CC-1.5.5  Skill auto-assignment — map classified site type to skill config file
  CC-1.5.6  Index builder orchestrator — wire crawler → extractor → embedder → profiler
            into a single pipeline that outputs a complete content index
  CC-1.5.7  Storage writers — save index to R2 (atoms, templates, brand profile),
            Vectorize (embeddings), KV (metadata, lookup indexes)
  CC-1.5.8  Tests with fixture content, mock Cerebras responses
```

#### 1.6 — Indexer Integration Test [SLICC]

End-to-end: give the indexer a real URL, get a complete content index.

```
Tasks:
  SLICC-1.6.1  Run full indexer pipeline against a test site
  SLICC-1.6.2  Inspect extracted block templates — do they look right when rendered?
  SLICC-1.6.3  Verify content atoms — are they coherent, properly tagged, no duplicates?
  SLICC-1.6.4  Check embedding quality — do semantically similar atoms cluster?
  SLICC-1.6.5  Validate brand profile — does it capture the site's voice accurately?
  SLICC-1.6.6  Measure timing — does the full pipeline complete in <3 minutes for 50 pages?
```

-----

### Phase 2: Intent Engine + Generation Pipeline (Weeks 3-4)

**Goal:** Given behavioral signals from a browsing session, infer intent, retrieve relevant content, generate personalized blocks, all within the 2.5s budget.

#### 2.1 — Intent Engine [Claude Code]

No LLM. Pure rules + embeddings. Must be sub-100ms.

```
Tasks:
  CC-2.1.1  Signal normalizer — convert raw events into typed Signal objects with timestamps
  CC-2.1.2  Signal aggregator — batch signals into session-level features:
            - Pages visited (count, categories, recency-weighted)
            - Engagement depth (avg scroll %, time distribution across sections)
            - Navigation pattern (linear, branching, returning, search-driven)
            - Click intent (CTA clicks, comparison clicks, detail expansions)
            - Temporal pattern (rapid scanning vs deep reading)
  CC-2.1.3  Intent archetype matcher — compare aggregated features against pre-defined
            archetypes using cosine similarity:
            - EXPLORE: broad browsing, short time per page, diverse topics
            - COMPARE: visiting similar pages, switching between items
            - DIVE_DEEP: long time on single topic, scrolling to bottom, expanding details
            - SEEK_ACTION: clicking CTAs, visiting pricing/contact, filling forms
            - RETURN: revisiting previously seen content
  CC-2.1.4  Confidence scorer — 0.0 to 1.0 based on signal volume and consistency.
            Thresholds:
            - < 0.3: No personalization (collect silently)
            - 0.3-0.6: Subtle reordering (move relevant blocks up)
            - 0.6-0.8: Moderate generation (replace 1-2 blocks)
            - > 0.8: Full personalization (generate multiple blocks, new content)
  CC-2.1.5  Topic vector builder — from visited pages + engaged content, build an embedding
            vector representing the user's current interest area
  CC-2.1.6  Skill-aware weight adjustment — load skill config, apply signal weight overrides
            (e.g., for pharma: weight HCP-indicator signals higher)
  CC-2.1.7  Tests: simulate browsing sessions, verify intent inference accuracy
```

#### 2.2 — Content Retrieval [Claude Code]

Given an intent vector, find the best content atoms and block templates for generation.

```
Tasks:
  CC-2.2.1  Query builder — translate IntentVector into a retrieval query:
            - Topic embedding for vector similarity search
            - Metadata filters (audience depth, content purpose, freshness)
            - Exclusions (atoms already shown in this session)
  CC-2.2.2  Atom ranker — score retrieved atoms by:
            - Semantic relevance (vector similarity)
            - Intent alignment (atom purpose matches user mode)
            - Freshness (prefer recently updated atoms)
            - Performance history (prefer high-engagement atoms, Vanilla mode only)
  CC-2.2.3  Template selector — pick the best block template for the context:
            - Page position (hero, mid-page, footer)
            - Content type match (template slots align with atom types)
            - Device appropriateness (mobile vs desktop template variant)
  CC-2.2.4  Composition matcher — in Vanilla mode, check if a pre-approved composition
            exists for this atom+template combination
  CC-2.2.5  Tests: given sample intents + content indexes, verify retrieval quality
```

#### 2.3 — Generation Engine [Claude Code]

The Cerebras-powered block generation pipeline.

```
Tasks:
  CC-2.3.1  Cerebras client — OpenAI-compatible API wrapper:
            - Support for GPT-OSS-120B, GLM-4.7, GLM-4.7-Flash
            - Streaming and non-streaming modes
            - Timeout handling (abort if approaching 2.5s budget)
            - Error handling with fallback chain (Cerebras → Workers AI → skip)
  CC-2.3.2  Model router — select model based on task:
            - content_fill → GPT-OSS-120B
            - layout_adapt → GLM-4.7
            - atom_select → GLM-4.7-Flash
            - compliance_check → GLM-4.7-Flash
            Apply urgency modifier: speculative pre-gen allows higher quality model choice
  CC-2.3.3  Prompt builder — assemble generation prompt from components:
            - System: brand brief (voice, tone, terminology) + skill constraints
            - Context: retrieved atoms as source material
            - Task: template slot definitions with character limits
            - Intent: what the user cares about, content depth, emotional register
            Total prompt must stay under 2,000 tokens input for speed
  CC-2.3.4  Content fill prompt template — for GPT-OSS:
            "Fill these slots using the provided content atoms, adapted for a user who is
            [intent description]. Voice: [brand brief]. Constraints: [slot definitions with
            limits]. Do not invent facts not present in the source atoms."
  CC-2.3.5  Layout adapt prompt template — for GLM-4.7:
            "Given this HTML block template and these content atoms, produce a modified HTML
            block that better serves [intent]. Maintain the site's CSS class naming patterns:
            [pattern examples]. Keep the visual language consistent with: [brand profile]."
  CC-2.3.6  Compliance checker — GLM-4.7-Flash quick pass:
            "Does this generated text violate any of these brand rules: [guardrails]?
            Return PASS or FAIL with reason."
  CC-2.3.7  Block assembler — take generated content, fill template slots, produce final HTML
            with inline styles (computed CSS from template extraction) + AI badge markup
  CC-2.3.8  Timing wrapper — measure each stage, enforce hard budget, abort gracefully
  CC-2.3.9  Tests: mock Cerebras responses, verify assembly quality, test timeout behavior
```

#### 2.4 — Pipeline Orchestrator [Claude Code]

Wire intent → retrieval → generation into a single pipeline with parallel execution.

```
Tasks:
  CC-2.4.1  Main pipeline: signal batch in → personalized blocks out
            - Parse signals → update intent state
            - If confidence below threshold → return empty (show original)
            - Retrieve atoms + select templates (parallel)
            - Generate block content via Cerebras
            - Assemble final HTML
            - Return blocks with injection instructions (which DOM element to replace)
  CC-2.4.2  Speculative pre-generation:
            - When confidence > 0.6, predict top 3 likely next pages
            - Pre-generate blocks for each predicted page
            - Cache with session+page+intent hash key, 60s TTL
            - On actual navigation: check cache first → instant injection if hit
  CC-2.4.3  Parallel block generation:
            - For pages needing multiple generative blocks, fire all Cerebras calls in parallel
            - Return blocks as they complete (don't wait for slowest)
  CC-2.4.4  Budget enforcement:
            - Hard 2.5s timeout from signal receipt
            - If generation incomplete at 2.0s, return whatever blocks are done
            - If nothing done by 2.5s, return empty (original page untouched)
  CC-2.4.5  Tests: full pipeline with mocked inference, verify timing, test cache hits/misses
```

-----

### Phase 3: Chrome Extension (Weeks 5-6)

**Goal:** Working demo — open extension on any website, index the site, browse, see progressive personalization with debug panel.

#### 3.1 — Extension Shell [Claude Code]

Manifest, build config, basic structure.

```
Tasks:
  CC-3.1.1  Extension manifest v3 — permissions: activeTab, scripting, storage, sidePanel
  CC-3.1.2  Vite build config for extension (content script + background + panel as separate entries)
  CC-3.1.3  Background service worker — lifecycle, message routing between content script and panel
  CC-3.1.4  Extension storage adapter — implement core StorageInterface using chrome.storage
            and IndexedDB for content index
  CC-3.1.5  Cerebras API key management — stored in chrome.storage.local, configurable in panel
  CC-3.1.6  Extension icon states: inactive (gray), indexing (pulse), active (colored),
            generating (animated)
```

#### 3.2 — Content Script [SLICC]

Signal collection and DOM injection. Must test against live pages.

```
Tasks:
  SLICC-3.2.1  Signal collector — attach event listeners for:
               - scroll (throttled to 200ms, capture depth per section)
               - click (capture target element, nearest semantic parent)
               - mouseover (dwell time on content blocks, 500ms threshold)
               - visibility (IntersectionObserver for block-level viewport tracking)
               - navigation (popstate, pushstate, click on links)
               - form interactions (input focus, value changes — no PII capture)
  SLICC-3.2.2  Signal batcher — collect signals, batch every 500ms, send to background
               service worker via chrome.runtime.sendMessage
  SLICC-3.2.3  Block injector — given a block replacement instruction
               {selector, html, transitionType}:
               - Find target element in DOM
               - Create a container with the generated HTML
               - Crossfade transition (opacity 0→1, 200ms)
               - Add AI badge (✦ icon, absolute positioned, top-right corner of block)
               - Handle layout shift: match dimensions of original block
  SLICC-3.2.4  SPA detector — MutationObserver on body for framework-driven page changes
               (React, Next.js, Vue Router). Detect route changes without full page reloads.
               Re-trigger signal collection and block injection on virtual navigation.
  SLICC-3.2.5  Original page preservation — store original block HTML before replacement,
               enable toggle (user can click AI badge to see original vs generative)
  SLICC-3.2.6  Test on 5 diverse live sites — verify signal collection completeness,
               injection visual quality, no layout shift, no JS errors, no style leakage
```

#### 3.3 — Debug Panel UI [Claude Code for structure, SLICC for testing]

```
Tasks:
  CC-3.3.1  Panel shell — React + Tailwind, side panel layout, collapsed/expanded toggle
  CC-3.3.2  IntentMeter component — confidence gauge (0-1), current archetype label,
            topic keywords, update in real time as signals flow
  CC-3.3.3  SignalLog component — scrolling list of recent signals with type icons,
            timestamps, and extracted meaning
  CC-3.3.4  BlockMap component — minimap of current page showing which blocks are
            original (gray) vs generative (highlighted). Click to inspect a block.
  CC-3.3.5  Block inspector — for any generative block, show: source atoms used,
            template selected, model used, generation time, confidence at generation time
  CC-3.3.6  TimingBreakdown component — waterfall chart showing per-block timing
            (retrieve → generate → assemble → inject) against the 2.5s budget line
  CC-3.3.7  Index status — show indexing progress, content atom count, block template count,
            brand profile summary, site classification result
  SLICC-3.3.8  Test panel against live extension — verify data flows from content script
               through background to panel, real-time updates work, no lag
```

#### 3.4 — Extension Integration [SLICC]

End-to-end demo flow.

```
Tasks:
  SLICC-3.4.1  "Index This Site" button — triggers indexer from the panel, shows progress,
               stores index in IndexedDB
  SLICC-3.4.2  Full demo walkthrough:
               - Open target website
               - Click extension icon → panel opens
               - Click "Index This Site" → watch progress → complete in ~2 min
               - Browse the site normally → watch signals appear in panel
               - After 3-4 page visits → see first generative blocks appear
               - Navigate to a new page → see pre-generated blocks load instantly
               - Click AI badge on a block → see original vs personalized
               - Expand panel → inspect intent, timing, content provenance
  SLICC-3.4.3  Timing validation — measure actual click-to-LCP for generative blocks,
               verify <2.5s across diverse sites and connection speeds
  SLICC-3.4.4  Edge cases: very slow sites, SPAs, sites with aggressive CSP,
               sites with Shadow DOM, infinite scroll pages
```

-----

### Phase 4: Cloudflare Worker (Weeks 7-8)

**Goal:** Production-ready edge deployment. Website owner adds JS snippet, generative personalization works at scale.

#### 4.1 — Worker Core [Claude Code]

```
Tasks:
  CC-4.1.1  Worker entry point — route handler for /signals, /blocks, /index, /analytics
  CC-4.1.2  Durable Object: UserSession
            - Stores intent state per user session (identified by cookie or fingerprint)
            - Methods: ingestSignals(signals[]), getIntent(), getBlocks(pageUrl)
            - Automatic expiry after 30 min inactivity
            - Handles concurrent requests (signal ingestion + block requests in parallel)
  CC-4.1.3  KV adapter — implements core StorageInterface:
            - Block templates keyed by site+blockType
            - Pre-generated blocks keyed by session+page+intentHash (60s TTL)
            - Brand profiles keyed by site
  CC-4.1.4  Vectorize adapter — implements core retrieval interface:
            - Namespace per indexed site
            - Query with topic embedding + metadata filters
            - Batch upsert during indexing
  CC-4.1.5  R2 adapter — bulk storage:
            - Raw content corpus per site
            - Full content index snapshots
            - Analytics event logs
  CC-4.1.6  Cerebras proxy — Worker calls Cerebras API:
            - API key stored as Worker secret
            - Response caching in KV for identical requests
            - Timeout enforcement with AbortController
            - Fallback to Workers AI binding
  CC-4.1.7  wrangler.toml — KV namespace bindings, R2 bucket, Vectorize index,
            Durable Object, Workers AI, secrets for Cerebras key
```

#### 4.2 — Production JS Snippet [Claude Code]

```
Tasks:
  CC-4.2.1  Minimal loader (<2KB gzipped) — async script that:
            - Reads config from data attributes on the script tag
            - Initializes signal collection (same logic as extension content script)
            - Establishes connection to Worker (fetch-based, not WebSocket)
            - On navigation: send signal batch → receive blocks → inject
  CC-4.2.2  Signal batching — same collection as extension but sends to Worker endpoint
            instead of chrome.runtime
  CC-4.2.3  Block injection — same DOM manipulation as extension content script
  CC-4.2.4  Session management — first-party cookie for returning visitor identification
  CC-4.2.5  Consent integration — optional data-consent attribute, if set:
            - Don't collect signals until consent callback fires
            - Respect cookie consent frameworks (OneTrust, CookieBot)
  CC-4.2.6  Build: Vite → single minified JS file, hosted on Worker (or CDN)
```

#### 4.3 — Speculative Pre-Generation Cache [Claude Code]

```
Tasks:
  CC-4.3.1  Next-page predictor — from session history, predict top 3 likely next pages:
            - Site navigation structure (extracted during indexing)
            - Current page's outgoing links ranked by visibility and position
            - User's navigation pattern (linear → predict next in sequence,
              branching → predict sibling pages)
  CC-4.3.2  Background pre-generation — after returning blocks for current page:
            - Fire parallel Cerebras requests for predicted next pages
            - Store results in KV with composite key: sessionId + pageUrl + intentHash
            - TTL: 60s (intent may shift, don't serve stale personalization)
  CC-4.3.3  Cache-first block serving — when /blocks is requested:
            - Check KV for pre-generated blocks matching current session+page+intent
            - Cache hit: return immediately (~50ms)
            - Cache miss: generate on demand (full pipeline, ~1200ms)
  CC-4.3.4  Cache invalidation — if intent shifts significantly between pages
            (confidence drops or archetype changes), invalidate pre-gen cache
```

#### 4.4 — Production Testing [Claude Code + SLICC]

```
Tasks:
  CC-4.4.1  Load testing — simulate 100 concurrent sessions against Worker
  CC-4.4.2  Latency benchmarking — measure P50/P95/P99 for block generation
  SLICC-4.4.3  Visual QA — load snippet on test sites, verify injection quality
  SLICC-4.4.4  Cross-browser testing — Chrome, Firefox, Safari, Edge
  CC-4.4.5  Error resilience — Cerebras timeout, Vectorize cold start, KV miss
```

-----

### Phase 5: Skills + Multi-Site Adaptation (Week 9)

**Goal:** The system works well across diverse website types through configurable skill profiles.

```
Tasks:
  CC-5.1    Define JSON Schema for skill configs — signal weights, guardrails,
            intent mapping overrides, generation constraints, required disclaimers
  CC-5.2    Pharma skill — HCP detection (repeated visits to clinical data, prescribing info
            pages), patient vs HCP content routing, ISI inclusion requirements,
            medical disclaimer injection
  CC-5.3    E-commerce skill — purchase funnel detection (browse→compare→cart),
            product comparison block generation, pricing sensitivity signals,
            urgency indicators (limited stock, time-bound offers)
  CC-5.4    SaaS skill — buyer stage mapping (awareness→consideration→decision),
            feature-vs-pricing signal interpretation, "convince my boss" content mode
            (generate shareable summaries), competitive comparison generation
  CC-5.5    Media skill — reading depth patterns, topic affinity tracking,
            related content generation, newsletter-style digest blocks for returning visitors
  CC-5.6    Auto-classification refinement — test classifier accuracy across 20 diverse sites
  CC-5.7    Skill hot-loading — Worker can load skill configs from KV without redeployment
```

-----

### Phase 6: Analytics + Learning Loop Foundation (Week 10)

**Goal:** Track what works, score content atom performance, surface gaps.

```
Tasks:
  CC-6.1    Engagement tracker — for each generative block, capture:
            - Block impression (appeared in viewport)
            - Dwell time (time block was visible)
            - Interaction (click, scroll into, expand)
            - Downstream action (navigation to CTA target within 60s)
            - Comparison: same metrics for original blocks on pages without generation
  CC-6.2    Atom performance scorer — aggregate engagement per content atom:
            - Usage count (how often selected by retrieval)
            - Engagement rate (interactions / impressions)
            - Conversion lift (downstream actions vs baseline)
            - Audience segmentation (which intents respond best to which atoms)
  CC-6.3    Gap analyzer — identify:
            - Intent patterns with low-quality content matches (retrieval confidence low)
            - Block positions with high bounce rates after injection (generation quality issue)
            - Audience modes underserved by available content
            - Templates that consistently produce poor engagement
  CC-6.4    Analytics dashboard endpoint — Worker route that returns summary metrics
            per site, per time period. Consumed by extension panel and future Vanilla UI.
  CC-6.5    Data pipeline — analytics events → R2 (raw) → aggregation Worker (cron) →
            KV (scores) → retrieval ranking boost
```

-----

## Appendix: Key Type Definitions (Starter)

```typescript
// core/types.ts

export interface ContentAtom {
  id: string;
  content: string;
  sourceUrl: string;
  blockPosition: number; // index within source page
  contentType: 'headline' | 'subheading' | 'body' | 'cta' | 'caption' | 'list-item' | 'stat';
  metadata: ContentMetadata;
  embedding?: number[];
  performance?: AtomPerformance;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentMetadata {
  topics: string[];           // extracted topic keywords
  audienceDepth: 'novice' | 'intermediate' | 'expert';
  purpose: 'inform' | 'persuade' | 'enable-action' | 'compare' | 'entertain';
  emotionalRegister: 'rational' | 'inspiring' | 'urgent' | 'empathetic' | 'authoritative';
  wordCount: number;
  language: string;
}

export interface AtomPerformance {
  usageCount: number;
  impressions: number;
  engagementRate: number;    // interactions / impressions
  conversionLift: number;    // vs baseline
  lastUsed: string;
  audienceBreakdown: Record<IntentArchetype, number>; // engagement per audience mode
}

export interface BlockTemplate {
  id: string;
  siteId: string;
  sourceUrl: string;
  blockType: string;         // 'hero' | 'feature-grid' | 'testimonial' | 'cta-banner' | etc.
  htmlShell: string;         // HTML with {{slot}} placeholders
  cssRules: string;          // computed CSS for this block
  slots: SlotDefinition[];
  responsive: {
    mobile: string;          // CSS overrides for <768px
    tablet: string;          // CSS overrides for 768-1024px
    desktop: string;         // CSS overrides for >1024px
  };
  position: 'hero' | 'above-fold' | 'mid-page' | 'below-fold' | 'footer';
}

export interface SlotDefinition {
  name: string;              // e.g., 'headline', 'body', 'ctaLabel', 'imageUrl'
  type: 'text' | 'rich-text' | 'image' | 'link' | 'list';
  constraints: {
    minLength?: number;
    maxLength?: number;
    required: boolean;
    pattern?: string;        // regex for format validation
  };
  originalContent: string;   // what was in this slot on the source page
}

export interface BrandProfile {
  siteId: string;
  voice: {
    tone: string[];          // e.g., ['professional', 'warm', 'confident']
    formality: 'casual' | 'balanced' | 'formal';
    personPerspective: 'first' | 'second' | 'third';
    characteristicPhrases: string[];
  };
  visual: {
    primaryColors: string[];
    fontFamilies: string[];
    spacingScale: number[];
  };
  guardrails: {
    forbiddenTerms: string[];
    requiredDisclaimers: { context: string; text: string }[];
    approvalRequired: boolean;
    maxGeneratedBlocksPerPage: number;
  };
  siteType: string;          // 'pharma' | 'ecommerce' | 'saas' | 'media' | 'corporate' | 'other'
  skillConfig: string;       // reference to skill JSON file
}

export type IntentArchetype = 'explore' | 'compare' | 'dive_deep' | 'seek_action' | 'return';

export interface IntentVector {
  sessionId: string;
  archetype: IntentArchetype;
  confidence: number;        // 0.0 - 1.0
  topicEmbedding: number[];  // what they're interested in
  audienceMode: ContentMetadata['audienceDepth'];
  contentDepth: 'overview' | 'detailed' | 'comprehensive';
  emotionalRegister: ContentMetadata['emotionalRegister'];
  signalCount: number;
  history: IntentSnapshot[];  // last N intent states for trend detection
  updatedAt: string;
}

export interface IntentSnapshot {
  archetype: IntentArchetype;
  confidence: number;
  timestamp: string;
}

export type SignalType =
  | 'page_visit' | 'scroll_depth' | 'click_target' | 'hover_dwell'
  | 'search_query' | 'filter_select' | 'navigation' | 'time_on_section'
  | 'form_interaction' | 'viewport_block_visibility';

export interface Signal {
  type: SignalType;
  timestamp: string;
  data: Record<string, unknown>;  // type-specific payload
  pageUrl: string;
}

export interface GenerationRequest {
  intent: IntentVector;
  pageUrl: string;
  targetBlock: {
    templateId: string;
    position: BlockTemplate['position'];
    existingContent: string;  // current block HTML for reference
  };
  retrievedAtoms: ContentAtom[];
  brandProfile: BrandProfile;
  budget: {
    maxTimeMs: number;       // remaining time in 2.5s budget
    maxInputTokens: number;  // default 2000
    maxOutputTokens: number; // derived from template slot constraints
  };
}

export interface GenerationResponse {
  blockHtml: string;         // ready-to-inject HTML with inline styles + AI badge
  model: string;             // which model was used
  atomsUsed: string[];       // IDs of atoms that sourced the content
  generationTimeMs: number;
  confidence: number;        // how well the generation matches the intent
  compliancePass: boolean;
}

export interface StorageInterface {
  // Atom retrieval
  queryAtoms(siteId: string, embedding: number[], filters: Partial<ContentMetadata>, limit: number): Promise<ContentAtom[]>;

  // Template retrieval
  getTemplate(siteId: string, templateId: string): Promise<BlockTemplate | null>;
  getTemplatesForPosition(siteId: string, position: BlockTemplate['position']): Promise<BlockTemplate[]>;

  // Brand profile
  getBrandProfile(siteId: string): Promise<BrandProfile | null>;

  // Cache
  getCachedBlock(key: string): Promise<string | null>;
  setCachedBlock(key: string, html: string, ttlSeconds: number): Promise<void>;

  // Analytics
  logEvent(event: AnalyticsEvent): Promise<void>;
}

export interface AnalyticsEvent {
  type: 'impression' | 'interaction' | 'dwell' | 'conversion';
  sessionId: string;
  pageUrl: string;
  blockId: string;
  atomIds: string[];
  isGenerative: boolean;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface SkillConfig {
  siteType: string;
  signalWeights: Partial<Record<SignalType, number>>;  // override default weights
  intentOverrides: {
    archetypeIndicators: Partial<Record<IntentArchetype, string[]>>; // additional signals
    confidenceBoosts: Partial<Record<string, number>>; // boost confidence for specific patterns
  };
  generationConstraints: {
    maxBlocksPerPage: number;
    requiredDisclaimers: { trigger: string; text: string }[];
    forbiddenTopics: string[];
    audienceDetection: { signal: string; audience: string; action: string }[];
  };
  promptModifiers: {
    systemSuffix: string;   // appended to generation system prompt
    toneOverride?: string;  // override brand voice for this site type
  };
}
```

-----

## Task Dependencies (Execution Order)

```
Week 1-2:
  CC-1.1 (scaffold) → CC-1.2 (types) → CC-1.3 (crawler) ─────────────────┐
                                                                            │
  [parallel with CC-1.3:]                                                   │
  SLICC-1.4 (extractor, needs types from CC-1.2) ──────────────────────────┤
                                                                            │
  CC-1.5 (embedder/profiler, needs CC-1.3 + SLICC-1.4 output) ────────────┤
                                                                            │
  SLICC-1.6 (integration test, needs all of above) ────────────────────────┘

Week 3-4:
  CC-2.1 (intent) ─────────────────────────────┐
  CC-2.2 (retrieval, needs CC-1.5 storage) ────┤
  CC-2.3 (generation, needs CC-1.2 types) ─────┤
                                                │
  CC-2.4 (orchestrator, wires 2.1+2.2+2.3) ───┘

Week 5-6:
  CC-3.1 (extension shell) ────────────────────────────────────┐
  SLICC-3.2 (content script, needs CC-2.4 pipeline working) ──┤
  CC-3.3 + SLICC-3.3.8 (panel, needs 3.1+3.2) ───────────────┤
  SLICC-3.4 (integration, needs all of phase 3) ──────────────┘

Week 7-8:
  CC-4.1 (worker, needs CC-2.4 pipeline) ──────┐
  CC-4.2 (snippet, needs CC-3.2 content script)┤
  CC-4.3 (cache, needs CC-4.1 worker) ─────────┤
  CC-4.4 + SLICC-4.4 (testing, needs all) ─────┘

Week 9:
  CC-5.x (skills, can start anytime after CC-1.2 types exist)

Week 10:
  CC-6.x (analytics, needs CC-4.1 worker running)
```

-----

## Getting Started

### Session 1 (Claude Code):

```bash
# Create project, install deps, scaffold structure
claude "Read the CLAUDE.md and the plan. Execute CC-1.1 and CC-1.2.
Set up the monorepo with all workspaces, install dependencies,
and create all type definitions in core/types.ts."
```

### Session 2 (Claude Code):

```bash
claude "Execute CC-1.3. Build the site crawler with sitemap parsing,
breadth-first crawling, and rate limiting. Write tests with fixture HTML."
```

### Session 3 (SLICC — open a target website):

```
Execute SLICC-1.4. Build the content extractor. Start by detecting block
boundaries on this page, then extract templates and content atoms.
Test against the rendered DOM you can see.
```

### And so on, following the dependency graph above.

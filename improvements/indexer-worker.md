# Indexer & Worker Improvements

## Section container detection for content insertion
- **Files**: `indexer/extractor/template-extractor.ts`, `core/types.ts`
- **Issue**: When creating templates for `insertAfter` injection, we need to identify the site's full-width section containers. Each site uses different markup (e.g., BMW uses `div.container.responsivegrid`, other sites may use `<section>`, `div.section`, etc.)
- **Impact**: Without knowing the section pattern, injected blocks don't match the site's layout rhythm and look out of place
- **Fix**: During indexing, detect the site's section container pattern by analyzing the DOM hierarchy under `<main>`. Look for repeating container elements at the same depth that span full width. Store the section pattern (CSS selector) in the `ContentIndex` or `BrandProfile`. Use this when building `insertAfter` templates to ensure injected blocks sit at the correct level with correct computed styles.
- **BMW example**: Sections are `div.container.responsivegrid` children of `main > .aem-Grid`. Each section is full-width (1752px) with spacing utilities like `style-common--cmp-spacing-top-16`

## Index endpoint is a stub
- **File**: `worker/routes/index-route.ts`
- **Issue**: Returns `"pending_implementation"` — Worker can't trigger indexing
- **Impact**: No way to index a site via the production API. Requires external CLI tool.
- **Fix**: Implement async indexing via queue (Cloudflare Queues) — Worker enqueues, separate consumer runs the crawler

## Hardcoded metadata defaults
- **Files**: `indexer/extractor/atom-extractor.ts`
- **Issue**: Emotional register always `'rational'`, language always `'en'`
- **Impact**: Non-English content fails silently; emotional tone of content ignored
- **Fix**: Use lightweight language detection (e.g., compact-language-detector), infer register from content patterns or LLM

## Form interaction PII risk
- **Files**: `extension/content-script/signals.ts`, `snippet/loader.ts`
- **Issue**: Form signals track field names — could expose "password", "ssn", "credit-card" field names
- **Impact**: Violates the "no PII" constraint in CLAUDE.md
- **Fix**: Allowlist safe field names or blocklist sensitive patterns before sending signals

## Session timeout too short
- **File**: `worker/session/durable-object.ts`
- **Issue**: 30s session timeout — user reading a long article loses their session
- **Fix**: Increase to 5-10 minutes, or reset timer on any signal receipt

## Aggressive cache invalidation
- **File**: `worker/storage/cache-strategy.ts`
- **Issue**: Any archetype change invalidates all cached blocks for the session
- **Impact**: Temporary intent fluctuations (e.g., one comparison click) wipe the cache
- **Fix**: Only invalidate if archetype change persists for N signals or confidence delta exceeds threshold

## SPA support incomplete in snippet
- **File**: `snippet/loader.ts`
- **Issue**: Detects pushState/replaceState but no MutationObserver for dynamically injected content
- **Impact**: Single-page apps that lazy-load content won't get blocks injected into new sections
- **Fix**: Add MutationObserver watching for new block-eligible DOM nodes

## Profiler heuristics are primitive
- **File**: `indexer/profiler.ts`
- **Issue**: Heuristic fallback uses contraction count for formality, hardcodes tone to `['professional']`
- **Impact**: When Cerebras is unavailable, brand profiles are generic and inaccurate
- **Fix**: Improve heuristics — analyze sentence length, vocabulary complexity, punctuation patterns

## No analytics processing pipeline
- **Files**: `worker/routes/analytics.ts`, `worker/storage/r2-adapter.ts`
- **Issue**: Analytics events are stored in R2 but never processed or aggregated
- **Impact**: Content scoring, gap analysis, and performance feedback loops don't work
- **Fix**: Implement scheduled batch processing (Cron Trigger) that reads events and updates atom performance scores

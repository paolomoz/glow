# Pitfalls

Common mistakes and gotchas when working with Glow.

## Intent Engine

### Problem: Adding LLM calls to the intent hot path

The intent engine must stay under 100ms. It uses rules + dot product scoring only.

| Do | Don't |
|----|-------|
| Add rules/heuristics to `core/intent/engine.ts` | Call Cerebras from intent inference |
| Use pre-computed embeddings for similarity | Generate embeddings on-demand during inference |
| Add new feature dimensions to the 6D vector | Run async LLM refinement in the synchronous path |

Background async refinement via GLM-4.7-Flash is acceptable — but not in the `ingestSignals()` or `inferFromAggregated()` call path.

### Problem: Dot product is not cosine similarity

The engine comments say "cosine similarity" but the implementation uses raw dot product. Archetype weight vectors have different magnitudes, which biases scoring.

**Impact:** Archetypes with larger total weights (e.g., dive_deep: 1.0+1.0+0.1 = 2.1) get higher raw scores than explore (1.0+0.2+0.3 = 1.5) even with identical feature vectors.

**Workaround:** The normalization step (`bestScore / totalScore`) partially compensates, but be aware when adding new archetypes.

### Problem: Momentum makes archetype switching sticky

Momentum blending (0.3 weight) + 80% switching threshold means a visitor must strongly signal a new intent to switch archetypes. After 10+ signals reinforcing one archetype, switching requires very high confidence.

**Impact:** If a user transitions from exploring to seeking action, it may take 3-5 strong CTA signals before the system catches up.

---

## Generation & Pipeline

### Problem: Budget exhaustion before generation

The orchestrator doesn't allocate budget between stages. A slow storage query (>1s) leaves less than 1.5s for generation — not enough for GPT-OSS-120B.

| Stage | Typical | If storage slow |
|-------|---------|----------------|
| Intent | 50ms | 50ms |
| Storage query | 200ms | 1200ms |
| Generation | 1200ms | **dropped (< 500ms remaining)** |
| Assembly | 50ms | — |

**Workaround:** The model router will downgrade to GLM-4.7-Flash (400ms), but if even that doesn't fit, blocks are silently dropped.

### Problem: Compliance check is not wired in

`core/generation/templates/compliance.ts` exists but the orchestrator never calls it. Generated content may violate brand guardrails.

**Impact:** Critical for pharma skill — ISI requirements and forbidden terms are not enforced.

**When fixing:** Add compliance as a post-generation step. If it fails, fall back to original content (not a regeneration — no budget for that).

### Problem: Token estimation is inaccurate

`CHARS_PER_TOKEN = 4` is a rough heuristic. Real tokenizers show 3.2-4.5 chars/token depending on content.

**Impact:** Prompts may be over-truncated (losing context) or exceed actual token limits (API error).

**Workaround:** Keep prompts well under the 2000 token limit to absorb estimation error.

### Problem: topicEmbedding is never populated

`IntentVector.topicEmbedding` starts as `[]` and no code path fills it. The atom selector falls back to 0.5 neutral score for semantic similarity.

**Impact:** The largest scoring weight (0.4) is effectively disabled. Atom selection relies only on intent alignment (0.3), freshness (0.15), and performance (0.15).

---

## Block Assembly & Injection

### Problem: XSS escaping may break intentional HTML

The slot filler escapes `<`, `>`, `"`, `'`, `&` in all slot values. If the generation model outputs HTML (e.g., for rich-text slots), the HTML will be escaped and rendered as text.

**Workaround:** For `layout_adapt` tasks where the model generates HTML, bypass slot filling and use the raw model output directly.

### Problem: AI badge positioning assumes relative parent

The badge uses `position: absolute; top: 4px; right: 4px;`. If the injected block's parent has `position: static`, the badge positions relative to the nearest positioned ancestor — potentially far from the block.

**Fix:** The assembler wraps in a `position: relative` div, but verify this doesn't break the site's layout.

### Problem: Crossfade may cause layout shift

The injector maintains `min-height` during the 200ms crossfade to prevent layout shift. But if the generated block is significantly taller/shorter than the original, there will be a jump after the transition completes.

---

## Extension vs Snippet Differences

| Behavior | Extension | Snippet |
|----------|-----------|---------|
| Signal batching interval | 500ms | 5000ms (configurable) |
| Backend | Service worker (local) | Cloudflare Worker (remote) |
| Storage | IndexedDB | KV + R2 + Vectorize |
| Debug panel | Yes (side panel) | No |
| Consent detection | No | Yes (OneTrust, Cookiebot) |
| SPA navigation | MutationObserver | pushState/replaceState only |
| Block toggle (original/generated) | Yes (click badge) | No |

### Problem: Extension and snippet capture signals differently

The extension uses `MutationObserver` for SPA navigation detection; the snippet only intercepts `pushState`/`replaceState`. Content loaded via `innerHTML` or framework rendering in SPAs may be missed by the snippet.

---

## Indexing

### Problem: Block detection is heuristic-based

Block boundaries are detected via semantic tags, visual gaps (≥16px margin/padding), and background color changes. Sites with flat DOM structures or CSS Grid layouts may have incorrect boundaries.

**Impact:** Templates may capture too much or too little content, leading to poor slot definitions.

### Problem: Metadata defaults are hardcoded

| Field | Default | Should be |
|-------|---------|-----------|
| `emotionalRegister` | `'rational'` | Inferred from content tone |
| `language` | `'en'` | Detected from content |
| `tone` (heuristic profiler) | `['professional']` | Inferred from vocabulary |

**Impact:** Non-English sites get English-language prompts. All content is treated as rational regardless of actual tone.

### Problem: Index endpoint is a stub

`worker/routes/index-route.ts` returns `"pending_implementation"`. The Worker cannot trigger indexing.

**Workaround:** Run indexing externally via Node.js CLI using the indexer package directly.

---

## Worker & Storage

### Problem: 30-second session timeout

The Durable Object expires sessions after 30 seconds of inactivity. A user reading a long article will lose their accumulated intent state.

**Impact:** After timeout, the next signal starts fresh — confidence drops to 0, no personalization until enough signals accumulate again.

### Problem: Cache invalidation is aggressive

Any archetype change invalidates all cached blocks for the session. A single anomalous signal (one comparison click during an explore session) can wipe the cache.

**Workaround:** The momentum blending prevents most single-signal archetype switches, but if confidence is borderline, cache thrashing is possible.

### Problem: Vectorize metadata filters are limited

Cloudflare Vectorize only supports equality filters on indexed metadata fields. Range queries (e.g., "freshness > 0.5") are not supported.

**Workaround:** Filter by discrete values (audienceDepth, purpose) at query time; apply continuous filters (freshness, performance) in `atom-selector.ts` post-retrieval.

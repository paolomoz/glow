# LLMO × Glow: Integration Analysis

## The Core Insight

LLMO gives Glow something it fundamentally lacks: **knowledge of what question brought the visitor to the page**.

Glow's intent engine (`core/intent/engine.ts`) currently infers intent from behavioral signals — clicks, scrolls, dwell time, navigation patterns. These are **implicit** signals. LLMO provides **explicit** intent data: the actual question a user typed into ChatGPT before visiting the page. This is the difference between guessing "this person seems to be comparing products" and knowing "this person asked ChatGPT: Lovesac stealthtech sectional vs regular sectional benefits."

## Value Proposition: 5 Integration Points

### 1. ChatGPT Referrer as a High-Confidence Signal

**Current state**: Glow captures `page_visit` signals with referrer data (`core/intent/signals.ts`), but treats all referrers equally.

**With LLMO**: When `document.referrer` contains `chat.openai.com` or `chatgpt.com`, Glow can:
- Look up the landing URL in the LLMO prompt index
- Retrieve the set of verified prompts that map to this page
- Use the prompt's `intent` field (informational/comparative/transactional/instructional/planning) to **skip behavioral inference entirely** and jump straight to high-confidence personalization

**Impact**: For ChatGPT-referred visitors, Glow goes from needing 3-5 behavioral signals to build confidence, to having **instant high-confidence intent** on the first page load. This means:
- First-paint personalization instead of waiting for scroll/click signals
- Sub-500ms content generation (cache hit on pre-generated prompt-specific blocks)
- The 2.5s budget becomes almost entirely available for generation quality

**Mapping LLMO intent → Glow archetypes**:

| LLMO Intent | Glow Archetype | ContentPurpose | Confidence |
|-------------|---------------|----------------|------------|
| informational | `explore` | `inform` | 0.7+ |
| comparative | `compare` | `compare` | 0.8+ |
| transactional | `seek_action` | `enable-action` | 0.8+ |
| instructional | `dive_deep` | `inform` | 0.7+ |
| planning | `explore` → `seek_action` | `inform` → `enable-action` | 0.6+ |

### 2. Content Atom Prioritization via Question-Content Alignment

**Current state**: `core/retrieval/atom-selector.ts` scores atoms on 4 dimensions:
- Semantic similarity (0.4 weight)
- Intent alignment (0.3 weight)
- Freshness (0.15 weight)
- Performance history (0.15 weight)

**With LLMO**: Add a 5th scoring dimension — **question-content alignment**:
- For each content atom, compute similarity against the LLMO prompt that likely brought the visitor
- Atoms that directly answer the inferred question get a significant boost
- This makes generation output more relevant to the specific question, not just the broad intent archetype

**Example**: A visitor arrives at `/sactionals-with-stealthtech-sound-charge` from ChatGPT. LLMO tells us the likely question is "Modular sectionals with built-in wireless chargers vs traditional sofas" (comparative intent). The atom selector now knows to prioritize comparison-structured content atoms over generic product descriptions.

### 3. Speculative Pre-Generation on Verified Questions

**Current state**: `core/pipeline/speculative.ts` pre-generates content for predicted next pages based on navigation patterns.

**With LLMO**: Pre-generate content blocks for **every verified prompt × page combination** during indexing time. The LLMO prompt set is finite (91 prompts for Lovesac), so we can:
- During `indexer/index-builder.ts` execution, generate blocks for each (prompt, URL, intent) tuple
- Store these in the cache layer (KV in production, IndexedDB in extension)
- On ChatGPT referral → instant cache hit → sub-400ms total latency

This is the **guaranteed sub-second personalization** path — no real-time LLM call needed.

### 4. Content Gap Analysis: "Not Referred" = Optimization Opportunity

**Current state**: `core/analytics/gaps.ts` finds content gaps by analyzing engagement rates per archetype.

**With LLMO**: The `referral` field in LLMO data reveals a powerful gap signal:
- **"referred"** (13 prompts in Lovesac data) = ChatGPT cites the page AND users click through. Content is working.
- **"not referred"** (78 prompts) = ChatGPT may cite the page but users don't click through, OR ChatGPT doesn't cite it at all. Content needs optimization.

For "not referred" pages, Glow can:
- Analyze what the LLMO prompts ask for vs what the page currently offers
- Generate optimized content blocks that better answer the verified questions
- Surface these as high-priority content gaps in the gap analyzer

**This directly addresses David's concern**: "insight on pages unlikely to get citation with current prompt set." Glow can tell site owners: "These 78 questions reference your pages but don't convert to visits. Here's what users expect vs what your page says."

### 5. Branded vs Unbranded: Audience Mode Differentiation

**Current state**: Glow's archetypes are behavioral (explore, compare, dive_deep, seek_action, return) but don't distinguish brand awareness level.

**With LLMO**: The `type` field (branded/unbranded) tells us whether the user already knows the brand:
- **Unbranded** ("Couch with hidden speakers for home theater"): Visitor is category-shopping. Glow should emphasize differentiation, social proof, brand story.
- **Branded** ("Lovesac stealthtech sectional vs regular sectional benefits"): Visitor already knows the brand. Glow should emphasize product details, pricing, configuration, conversion CTAs.

This creates a 2×5 matrix (branded/unbranded × 5 intent types) for much more precise personalization than the current 5 archetypes alone.

## Architecture: How It Fits

```
LLMO Data (CSV/API)
  ↓
llmo/prompt-index.ts          ← NEW: parse + index LLMO prompts by URL
  ↓
core/intent/signals.ts        ← MODIFY: detect ChatGPT referrer, emit llmo_referral signal
  ↓
core/intent/engine.ts         ← MODIFY: when llmo_referral signal present, use LLMO intent
  ↓
core/retrieval/atom-selector.ts ← MODIFY: add question-content alignment scoring
  ↓
core/analytics/gaps.ts        ← MODIFY: incorporate LLMO "not referred" gaps
  ↓
indexer/index-builder.ts      ← MODIFY: pre-generate blocks for verified prompts
```

### New Components

1. **`llmo/prompt-index.ts`** — Parse CSV, build URL→prompts lookup, embed prompts for similarity search
2. **`llmo/referral-detector.ts`** — Detect ChatGPT/agentic referrers, match to LLMO prompt set
3. **`llmo/gap-reporter.ts`** — Combine LLMO "not referred" data with Glow gap analysis

### Modified Components

1. **`core/types.ts`** — Add `LLMOPrompt` type, add `llmo_referral` signal type
2. **`core/intent/signals.ts`** — Detect ChatGPT referrer in page_visit signals
3. **`core/intent/engine.ts`** — Short-circuit to high-confidence intent when LLMO match found
4. **`core/retrieval/atom-selector.ts`** — New `questionAlignment` scoring dimension
5. **`core/analytics/gaps.ts`** — New `findLLMOGaps()` method

## Data Flow: ChatGPT Visitor → Personalized Page

```
1. User asks ChatGPT: "Modular sectionals with built-in wireless chargers vs traditional sofas"
   ↓
2. ChatGPT cites lovesac.com/sactionals-with-stealthtech-sound-charge
   ↓
3. User clicks through → lands on page with referrer=chatgpt.com
   ↓
4. Glow snippet/extension captures page_visit with ChatGPT referrer
   ↓
5. llmo/referral-detector.ts matches URL → retrieves candidate prompts
   ↓
6. Intent engine sets: archetype=compare, confidence=0.8, purpose=compare
   ↓
7. Cache lookup: pre-generated block for this (URL, intent, prompt) → HIT
   ↓
8. Inject comparison-focused content block in <400ms
   ↓
   OR (cache miss):
   ↓
7b. Atom selector boosts comparison atoms, filters by question alignment
   ↓
8b. Generation with question-aware prompt: "User asked about wireless chargers vs traditional"
   ↓
9b. Inject personalized block within 2.5s budget
```

## Consumption Alignment

### ASO (Adobe Sites Optimizer)
- Glow's gap analysis + LLMO "not referred" data → actionable experiments
- "Page X gets 12 citation attempts for comparison questions but no referrals. Glow generated comparison blocks that increased engagement 40%. Suggestion: make this content permanent."

### EDS (Generative Websites)
- Glow IS the on-the-fly content optimization engine
- LLMO verified questions become the **intent vocabulary** for Glow's generation
- First customer (e.g. Vitamix): index site → import LLMO prompts → pre-generate → deploy

### David's Concern (Pages Unlikely to Get Citations)
- Glow can analyze page content vs LLMO prompt universe
- Identify pages with no matching prompts → "These pages have no agentic traffic potential with current content"
- Generate optimized content that WOULD answer existing prompts → increase citation likelihood
- This is the feedback loop: LLMO identifies questions → Glow generates answers → pages get cited → LLMO measures improvement

## Key Numbers from Lovesac Data

| Metric | Value |
|--------|-------|
| Total prompts | 91 |
| Referred (ChatGPT sends traffic) | 13 (14%) |
| Not referred (opportunity) | 78 (86%) |
| Unique URLs | 21 |
| Intent: informational | 28 (31%) |
| Intent: transactional | 30 (33%) |
| Intent: comparative | 16 (18%) |
| Intent: instructional | 8 (9%) |
| Intent: planning | 9 (10%) |
| Branded prompts | ~45 (49%) |
| Unbranded prompts | ~46 (51%) |

The 86% "not referred" rate is the opportunity. These are pages that ChatGPT knows about but can't convert to visits — either because the content doesn't answer the question well enough, or ChatGPT doesn't cite them. Glow can address both.

## Next Steps

1. **Parse and index** the LLMO CSV into a typed prompt index
2. **Add ChatGPT referrer detection** to the signal normalizer
3. **Build the intent short-circuit** for LLMO-matched visitors
4. **Prototype with Lovesac** — pre-generate blocks for the 91 verified prompts
5. **Wait for Halliburton + Kellogg's data** to validate cross-industry patterns
6. **Define API contract** with LLMO team for ongoing prompt feed (not just CSV)

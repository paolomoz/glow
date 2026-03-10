# Intent Engine Improvements

## Dot product vs cosine similarity
- **File**: `core/intent/engine.ts`
- **Issue**: Comments claim cosine similarity but implementation uses raw dot product — archetype vectors aren't normalized
- **Impact**: Archetypes with larger weight magnitudes get unfairly boosted
- **Fix**: Normalize feature vectors before dot product, or switch comments to reflect actual behavior

## Unused signal types in feature extraction
- **File**: `core/intent/engine.ts`
- **Signals**: hover_dwell, filter_select, form_interaction, viewport_block_visibility
- **Issue**: These signals are counted for signal boost but don't contribute to the 6D feature vector
- **Impact**: Rich interaction data is wasted — hover dwell and form interaction could strongly indicate seek_action or dive_deep
- **Fix**: Add feature dimensions or fold into existing ones (e.g., hover_dwell → avgTimePerPage, form_interaction → ctaClickRate)

## No recency decay on signals
- **File**: `core/intent/engine.ts`
- **Issue**: All signals in the aggregation window carry equal weight regardless of age
- **Impact**: Stale browsing patterns (e.g., explored 5 minutes ago, now seeking action) dilute current intent
- **Fix**: Apply exponential decay based on signal timestamp relative to most recent signal

## Hardcoded CTA/comparison regex
- **File**: `core/intent/signals.ts`
- **Issue**: CTA detection (`buy|sign.?up|subscribe|...`) and comparison detection use fixed regex — no stemming, no synonyms
- **Impact**: Misses variations like "buying", "subscription", "sign me up", non-English CTAs
- **Fix**: Use configurable keyword lists per skill config, or a lightweight stemmer

## Naive URL categorization
- **File**: `core/intent/engine.ts`
- **Issue**: Categorizes URLs by simple path includes (`/product`, `/blog`, etc.)
- **Impact**: Fails on custom URL structures, query params, hash routing, multi-domain sites
- **Fix**: Allow skill configs to define URL category patterns, or learn from crawled site structure

## Binary return visit detection
- **File**: `core/intent/engine.ts`
- **Issue**: returnVisitRate is binary (0.8 or 0.1) based solely on navigation pattern
- **Impact**: No gradient — a 2-page revisit scores the same as a deep return session
- **Fix**: Scale based on revisit frequency and depth

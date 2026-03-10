# Pipeline & Generation Improvements

## Compliance check not integrated
- **Files**: `core/pipeline/orchestrator.ts`, `core/generation/templates/compliance.ts`
- **Issue**: Compliance check prompt template exists but the orchestrator never calls it
- **Impact**: Generated content could violate brand guardrails (forbidden terms, missing disclaimers)
- **Priority**: High — especially for pharma skill where ISI requirements are legal obligations
- **Fix**: Add compliance step after generation, before assembly. If fail, either regenerate or fall back to original content.

## Non-streaming Cerebras client
- **File**: `core/generation/cerebras-client.ts`
- **Issue**: All requests are non-streaming — waits for full response before processing
- **Impact**: Wastes time within the 2.5s budget. Streaming could start block assembly while tokens arrive.
- **Fix**: Implement SSE streaming with incremental JSON parsing for content_fill tasks

## No retry or fallback on generation failure
- **File**: `core/pipeline/orchestrator.ts`
- **Issue**: Failed block generation returns null silently — no retry, no downgrade attempt
- **Impact**: Users see fewer personalized blocks than confidence level warrants
- **Fix**: On failure, attempt next model in fallback chain if budget allows. Log failures for observability.

## Cache hit hardcodes model name
- **File**: `core/pipeline/orchestrator.ts:109`
- **Issue**: Cache hits always report `model: 'glm-4.7-flash'` regardless of which model generated the cached content
- **Fix**: Store the model ID alongside cached HTML

## 500ms minimum budget cutoff
- **File**: `core/pipeline/orchestrator.ts:194`
- **Issue**: Blocks are silently dropped if < 500ms remains — no graceful degradation
- **Impact**: High-confidence sessions may get fewer blocks than expected if retrieval is slow
- **Fix**: Use model router to find a fast model that fits the remaining budget, or serve a pre-cached variant

## No budget allocation between stages
- **File**: `core/pipeline/orchestrator.ts`
- **Issue**: Retrieval has no budget cap — a slow retrieval eats into generation time
- **Fix**: Allocate explicit budgets (e.g., 30% retrieval, 60% generation, 10% assembly) with hard cutoffs

## Token estimation is inaccurate
- **File**: `core/generation/prompt-builder.ts:34`
- **Issue**: Uses `chars / 4` as token estimate — real tokenizers show 3.2-4.5 chars/token depending on content
- **Impact**: May over-truncate prompts or exceed actual token limits
- **Fix**: Use a lightweight tokenizer (tiktoken-lite) or calibrate the ratio per model

## Hardcoded model latency estimates
- **File**: `core/generation/model-router.ts`
- **Issue**: Latency estimates (1200/800/400/600ms) are static — don't reflect actual observed latencies
- **Fix**: Track rolling P50/P95 latencies and update routing decisions dynamically

## topicEmbedding never populated
- **File**: `core/pipeline/orchestrator.ts`
- **Issue**: `intentState.topicEmbedding` starts as empty array and there's no code path that populates it
- **Impact**: Atom selector always falls back to 0.5 neutral semantic similarity score
- **Fix**: Generate topic embedding from aggregated signal context (page titles, clicked text) via embedder

## getTemplatesForPage ignores pageUrl
- **File**: `core/pipeline/orchestrator.ts:251`
- **Issue**: Template selection doesn't consider the page being personalized
- **Impact**: Returns generic templates instead of page-appropriate ones
- **Fix**: Match templates by URL pattern or page category from crawl data

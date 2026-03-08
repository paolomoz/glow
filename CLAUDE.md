# Glow — Generative Layer Over Web

## Implementation Plan
See [PLAN.md](./PLAN.md) for the full implementation plan with phases, task IDs, and dependency graph.

## Project Overview
Real-time generative personalization overlay for any website. Sub-2.5s click-to-LCP.
Cerebras inference (GPT-OSS-120B, GLM-4.7, GLM-4.7-Flash). Cloudflare edge deployment.

## Architecture
- core/ — Shared pipeline logic (pure TypeScript, zero platform deps)
- indexer/ — Site → Content Index (crawler, extractor, embedder, profiler)
- extension/ — Chrome extension for demo mode
- worker/ — Cloudflare Worker for production mode
- snippet/ — Minimal JS tag for website integration
- skills/ — Website-type JSON configs

## Key Constraints
- All LLM calls go through core/generation/cerebras-client.ts
- Intent engine (core/intent/) NEVER uses LLM calls — rules + embeddings only
- All storage access goes through core/retrieval/interfaces.ts (platform adapters implement it)
- Block generation must complete within 2.5s total from signal receipt
- Content script and injection code must work on any website without breaking existing JS/CSS
- Generated HTML must use inline styles derived from extracted computed CSS — no external stylesheets

## Testing
- Run: `npx vitest run`
- Core tests use mocked Cerebras responses (see test/fixtures/)
- Integration tests use a local Miniflare instance for Worker testing

## Build
- Core: `tsc` (outputs to dist/core/)
- Extension: `cd extension && npx vite build` (outputs to dist/extension/)
- Worker: `cd worker && npx wrangler deploy` (or `npx wrangler dev` for local)
- Snippet: `cd snippet && npx vite build` (outputs dist/snippet/glow.min.js)

## Cerebras Models
- GPT-OSS-120B: Content generation (headlines, body, CTAs) — endpoint: https://api.cerebras.ai/v1
- GLM-4.7: Layout-aware HTML generation — same endpoint
- GLM-4.7-Flash: Lightweight tasks (atom selection, compliance) — same endpoint
- Workers AI (Llama 3.3 8B): Fallback only

## Naming Conventions
- Files: kebab-case (signal-processor.ts)
- Types: PascalCase (ContentAtom, BlockTemplate)
- Functions: camelCase (buildPrompt, routeModel)
- Constants: SCREAMING_SNAKE (MAX_GENERATION_TIME_MS, MIN_CONFIDENCE_THRESHOLD)

## Don't
- Add LLM calls to the intent engine hot path
- Use external stylesheets in injected blocks
- Store PII in any storage layer
- Exceed 2,000 input tokens in generation prompts
- Generate content not grounded in indexed content atoms (no hallucinated facts)

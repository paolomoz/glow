# Glow — Generative Layer Over Web

## Documentation
- [docs/README.md](./docs/README.md) — Entry point, task routing, layer quick reference
- [docs/architecture.md](./docs/architecture.md) — Layer stack, source tree, file-finding guide, data flows
- [docs/development.md](./docs/development.md) — Commands, env vars, verification checklist
- [docs/testing.md](./docs/testing.md) — Test patterns, mocking, fixtures
- [docs/adding-features.md](./docs/adding-features.md) — Step-by-step guides for 8 common tasks
- [docs/pitfalls.md](./docs/pitfalls.md) — Common mistakes and gotchas
- [PLAN.md](./PLAN.md) — Implementation plan with phases, task IDs, and dependency graph

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
  - Vite copies static files (manifest.json, panel.html, icons/) via `copy-static-files` plugin
  - If you add new static assets, add them to this plugin in `extension/vite.config.ts`
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

## Self-Maintenance
- When you learn something important about this project (gotchas, patterns, architecture decisions), add it to CLAUDE.md or the memory files
- Keep CLAUDE.md minimal — use references to docs/, improvements/, or memory files for details rather than inlining long explanations here
- Memory files: `/Users/paolo/.claude/projects/-Users-paolo-excat-glow/memory/` (persists across conversations)

## Improvement Tracking
- Improvement opportunities are tracked in `improvements/` as markdown files, organized by area
- Current files: `intent-engine.md`, `pipeline-generation.md`, `indexer-worker.md`
- When reviewing code or discussing changes, log new improvement observations to the appropriate file
- Each improvement entry should include: file path, issue description, impact, and suggested fix
- When an improvement is implemented, remove it from the file or mark it with `[DONE]`

## Implementation Approach
- Build the real system, not throwaway demos — every hour of work must advance production code
- Never customize implementation for a specific target site — the system must work for any site
- When hitting a blocker, mock only the specific thing that's blocking (e.g., API down, site uncrawlable) — not entire subsystems
- Test against real sites, real Cerebras API calls, real indexer output
- The extension is the primary demo vehicle; the Worker is the production path
- ChatGPT conversations are an intent source — parse them into the existing intent system, don't build a parallel path

## Don't
- Add LLM calls to the intent engine hot path
- Use external stylesheets in injected blocks
- Store PII in any storage layer
- Exceed 2,000 input tokens in generation prompts
- Generate content not grounded in indexed content atoms (no hallucinated facts)
- Build throwaway demo harnesses or in-memory adapters that duplicate real storage paths
- Hardcode fixtures when the real indexer/extractor can produce the data
- Customize logic for a specific target site

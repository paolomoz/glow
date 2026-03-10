# Glow Documentation

## I need to...

| Goal | Read |
|------|------|
| Understand the system architecture | [architecture.md](architecture.md) |
| Find which file to modify | [architecture.md § File-Finding Guide](architecture.md#file-finding-guide) |
| Build, run, or debug locally | [development.md](development.md) |
| Write or understand tests | [testing.md](testing.md) |
| Add a new feature or capability | [adding-features.md](adding-features.md) |
| Avoid common mistakes | [pitfalls.md](pitfalls.md) |
| Track known improvement opportunities | [../improvements/](../improvements/) |

## Layer Quick Reference

| Layer | Directory | Key File | Purpose |
|-------|-----------|----------|---------|
| Intent | `core/intent/` | `engine.ts` | Rules-based intent inference from behavioral signals |
| Retrieval | `core/retrieval/` | `atom-selector.ts` | Content atom ranking via embedding similarity |
| Generation | `core/generation/` | `cerebras-client.ts` | LLM content generation via Cerebras API |
| Blocks | `core/blocks/` | `assembler.ts` | Template slot filling and HTML assembly |
| Pipeline | `core/pipeline/` | `orchestrator.ts` | End-to-end orchestration with 2.5s budget |
| Analytics | `core/analytics/` | `scorer.ts` | Engagement tracking and content scoring |
| Skills | `core/skills/` | `loader.ts` | Website-type configs and auto-classification |
| Indexer | `indexer/` | `index-builder.ts` | Site crawling, extraction, embedding |
| Worker | `worker/` | `index.ts` | Cloudflare Worker production runtime |
| Extension | `extension/` | `content-script/signals.ts` | Chrome extension demo mode |
| Snippet | `snippet/` | `loader.ts` | Production JS tag (<5KB) |

## Vocabulary

| Term | Meaning |
|------|---------|
| Content Atom | Smallest unit of indexed content (headline, body paragraph, CTA, stat) |
| Block Template | HTML shell with `{{slot}}` placeholders + extracted CSS |
| Intent Archetype | One of 5 behavioral profiles: explore, compare, dive_deep, seek_action, return |
| Skill Config | JSON file defining site-type-specific signal weights, constraints, disclaimers |
| Slot | Named placeholder in a block template (e.g., `{{headline}}`, `{{cta}}`) |
| Progressive Personalization | More blocks replace as intent confidence grows (0→1→2→5 blocks) |
| Time Budget | Hard 2,500ms cap from signal receipt to HTML injection |
| Brand Profile | Extracted voice, visual identity, and guardrails for a site |

## Constants

| Constant | Value | File |
|----------|-------|------|
| `MAX_GENERATION_TIME_MS` | 2500 | `core/types.ts` |
| `MIN_CONFIDENCE_THRESHOLD` | 0.3 | `core/types.ts` |
| `MODERATE_CONFIDENCE_THRESHOLD` | 0.6 | `core/types.ts` |
| `HIGH_CONFIDENCE_THRESHOLD` | 0.8 | `core/types.ts` |
| `MAX_INPUT_TOKENS` | 2000 | `core/types.ts` |
| `SPECULATIVE_CACHE_TTL_SECONDS` | 60 | `core/types.ts` |
| `SIGNAL_BATCH_INTERVAL_MS` | 500 | `core/intent/signals.ts` |

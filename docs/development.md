# Development

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >=18 | Runtime |
| npm | >=9 | Package manager (workspaces) |
| Wrangler | >=3 | Cloudflare Worker dev/deploy |
| Chrome | >=120 | Extension testing |

## Setup

```bash
npm install          # Install all workspace dependencies
```

## Commands

| Command | What it does | When to use |
|---------|-------------|-------------|
| `npx vitest run` | Run all tests once | Before committing |
| `npx vitest` | Run tests in watch mode | During development |
| `npx vitest run --coverage` | Run tests with coverage | Checking coverage gaps |
| `npm run build` | TypeScript build (all packages) | Verify types compile |
| `npm run lint` | `tsc --noEmit` | Type-check without emitting |
| `cd worker && npx wrangler dev` | Local Worker dev server | Testing Worker routes |
| `cd extension && npx vite build` | Build Chrome extension | Testing extension |
| `cd snippet && npx vite build` | Build production snippet | Testing snippet (<5KB) |

## Workspaces

| Workspace | Directory | Has own `package.json` |
|-----------|-----------|----------------------|
| core | `core/` | Yes |
| indexer | `indexer/` | Yes |
| extension | `extension/` | Yes |
| worker | `worker/` | Yes |
| snippet | `snippet/` | Yes |

## Environment Variables

| Variable | Required | Used by | Purpose |
|----------|----------|---------|---------|
| `CEREBRAS_API_KEY` | Worker, Extension | `core/generation/cerebras-client.ts` | Cerebras API authentication |
| `ALLOWED_ORIGINS` | Worker | `worker/index.ts` | CORS allow list |

Worker bindings (configured in `worker/wrangler.toml`):

| Binding | Type | Name |
|---------|------|------|
| `BLOCKS_KV` | KV Namespace | Block templates + cached blocks |
| `CACHE_KV` | KV Namespace | Speculative pre-generation cache |
| `CONTENT_R2` | R2 Bucket | `glow-content` — raw HTML, index snapshots |
| `CONTENT_VECTORIZE` | Vectorize Index | `glow-atoms` — atom vector search |
| `USER_SESSION` | Durable Object | `UserSession` — per-session intent state |
| `AI` | Workers AI | Fallback inference (Llama 3.3 8B) |

## Worker Routes

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | `/signals` | `worker/routes/signals.ts` | Ingest behavioral signals → Durable Object |
| GET | `/blocks` | `worker/routes/blocks.ts` | Return generated blocks for a page |
| POST | `/index` | `worker/routes/index-route.ts` | Trigger site indexing (stub) |
| POST | `/analytics` | `worker/routes/analytics.ts` | Store engagement events → R2 |
| GET | `/health` | `worker/index.ts` | Health check |

## Extension Development

1. Build: `cd extension && npx vite build`
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Click "Load unpacked" → select `dist/extension/`
5. Open any website → extension activates automatically
6. Open side panel for debug UI (intent meter, signal log, block map, timing)

## KV Key Schema

| Pattern | Value | Used for |
|---------|-------|----------|
| `template:{siteId}:{templateId}` | BlockTemplate JSON | Template storage |
| `templates:{siteId}:{position}` | templateId[] | Position-based lookup |
| `profile:{siteId}` | BrandProfile JSON | Brand profile |
| `cache:{key}` | HTML string | Cached generated blocks |
| `atoms:{siteId}` | ContentAtom[] | Atom storage (small sites) |
| `atom:{atomId}` | ContentAtom JSON | Individual atom (Vectorize companion) |

## R2 Key Schema

| Pattern | Content | Used for |
|---------|---------|----------|
| `corpus/{siteId}/index.json` | Full ContentIndex | Index snapshots |
| `corpus/{siteId}/pages/{pageHash}` | Raw HTML | Page corpus |
| `events/{date}/{batchId}.jsonl` | Analytics events | Event storage |

## Verification Checklist

Before committing:

- [ ] `npx vitest run` passes
- [ ] `npm run lint` passes (no type errors)
- [ ] No `.env` or secrets committed (check `.gitignore`)
- [ ] New files follow naming convention: kebab-case (e.g., `signal-processor.ts`)
- [ ] Types: PascalCase. Functions: camelCase. Constants: SCREAMING_SNAKE.
- [ ] No LLM calls added to `core/intent/` hot path
- [ ] No external stylesheets in injected blocks (inline only)
- [ ] Generation prompts under 2,000 input tokens
- [ ] New improvement observations logged in `improvements/`

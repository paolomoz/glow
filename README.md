<p align="center">
  <img src="docs/images/hero-banner.png" alt="Glow — Generative Layer Over Web" width="100%" />
</p>

<h1 align="center">Glow</h1>

<p align="center">
  <strong>Generative Layer Over Web</strong><br/>
  Real-time, intent-driven personalization overlay for any website.<br/>
  No migration. No CMS change. No code access required.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/inference-Cerebras-6366F1?style=flat-square" alt="Cerebras" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/click_to_LCP-%3C2.5s-10B981?style=flat-square" alt="< 2.5s LCP" />
</p>

---

## What is Glow?

Glow injects **AI-generated, personalized content blocks** into any existing website in real time. It watches how visitors browse, infers their intent, and dynamically adapts headlines, CTAs, product comparisons, and more — all within a **sub-2.5 second** time budget.

The longer a visitor browses, the more the site adapts to them. Progressive personalization, powered by behavioral signals and Cerebras inference at the edge.

---

## Architecture

<p align="center">
  <img src="docs/images/architecture-overview.png" alt="Architecture Overview" width="500" />
</p>

Glow is built as a **5-layer pipeline** that runs entirely at the edge:

| Layer | What it does | Key module |
|-------|-------------|------------|
| **Signals** | Captures clicks, scrolls, hovers, navigation patterns | `extension/content-script/signals.ts` |
| **Intent** | Rules-based inference — no LLM in the hot path, sub-100ms | `core/intent/engine.ts` |
| **Retrieval** | Fetches relevant content atoms via embedding similarity | `core/retrieval/atom-selector.ts` |
| **Generation** | Cerebras-powered content generation (GPT-OSS-120B, GLM-4.7) | `core/generation/cerebras-client.ts` |
| **Assembly** | Fills block templates, injects styled HTML into the page | `core/blocks/assembler.ts` |

---

## Pipeline

<p align="center">
  <img src="docs/images/pipeline-flow.png" alt="Pipeline Flow" width="100%" />
</p>

Every personalization request flows through 5 stages — **signal to screen in under 2.5 seconds**:

```
User Signal → Intent Engine → Content Retrieval → AI Generation → Block Injection
   (click)     (rules+embed)    (vector search)    (Cerebras)      (inline HTML)
```

### Time Budget

| Path | Target | How |
|------|--------|-----|
| Cache hit (pre-generated) | ~400ms | KV read, inject |
| On-demand, content fill | ~1,200ms | Retrieve, GPT-OSS-120B, inject |
| On-demand, layout adapt | ~1,500ms | Retrieve, GLM-4.7, inject |
| Fallback (Workers AI) | ~2,200ms | Retrieve, Llama 3.3 8B, inject |
| Hard timeout | 0ms delta | Show original page unchanged |

---

## Deployment Modes

<p align="center">
  <img src="docs/images/deployment-modes.png" alt="Deployment Modes" width="100%" />
</p>

<table>
  <tr>
    <td align="center" width="33%">
      <h3>Demo</h3>
      <strong>Chrome Extension</strong><br/>
      Zero infrastructure. Install the extension, add a Cerebras API key, and it works on any website instantly. Includes a debug panel for intent visualization.
    </td>
    <td align="center" width="33%">
      <h3>Production</h3>
      <strong>JS Snippet + Cloudflare Workers</strong><br/>
      Website owner adds a <code>&lt;script&gt;</code> tag. Full edge infrastructure with speculative pre-generation, session persistence, and analytics.
    </td>
    <td align="center" width="33%">
      <h3>Vanilla</h3>
      <strong>Content Repository</strong><br/>
      Brand owns a structured content repository with a closed learning loop. Content authors work through AI agents.
    </td>
  </tr>
</table>

---

## Project Structure

```
glow/
├── core/                # Shared pipeline logic (pure TypeScript, zero platform deps)
│   ├── intent/          # Rules-based intent inference, archetypes, progressive personalization
│   ├── retrieval/       # Query building, atom selection, storage interfaces
│   ├── generation/      # Cerebras client, model routing, prompt templates
│   ├── blocks/          # Block registry, slot filling, HTML assembly, AI badge
│   ├── pipeline/        # Orchestrator, speculative pre-generation, timeout enforcement
│   ├── analytics/       # Engagement tracking, content scoring, gap analysis
│   ├── skills/          # Site-type configs, auto-classification, hot-loading
│   └── types.ts         # All shared type definitions
│
├── indexer/             # Site → Content Index (crawler, extractor, embedder, profiler)
├── extension/           # Chrome Extension for demo mode
├── worker/              # Cloudflare Worker for production mode
├── snippet/             # Minimal JS tag for website integration (<5KB gzipped)
├── skills/              # Website-type JSON configs (pharma, ecommerce, saas, media)
└── test/                # Unit + integration tests with mocked Cerebras responses
```

---

## Inference Stack

| Model | Speed | Use case |
|-------|-------|----------|
| **GPT-OSS-120B** | ~3,000 tok/s | Content generation — headlines, body, CTAs |
| **GLM-4.7** | ~1,000-1,700 tok/s | Layout-aware HTML generation |
| **GLM-4.7-Flash** | ~80 tok/s | Lightweight tasks — atom selection, compliance |
| **Llama 3.3 8B** | Workers AI | Fallback only |

All LLM calls route through `core/generation/cerebras-client.ts`. The intent engine **never** uses LLM calls — rules and embeddings only.

---

## Skills

Glow adapts its behavior based on **website type** through skill configs:

- **Pharma** — HCP vs patient detection, ISI requirements, disclaimer injection
- **E-commerce** — Purchase intent signals, product comparison patterns
- **SaaS** — Buyer stage inference, feature-vs-pricing signals
- **Media** — Content consumption depth patterns

Skills are JSON configs in `skills/` and can be hot-loaded at runtime.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npx vitest run

# Build all packages
npm run build

# Dev — run Worker locally
cd worker && npx wrangler dev

# Dev — build Chrome extension
cd extension && npx vite build
```

---

## Key Constraints

- All generated content is **grounded in indexed content atoms** — no hallucinated facts
- Generated HTML uses **inline styles** derived from extracted computed CSS — no external stylesheets
- Content script works on **any website** without breaking existing JS/CSS
- **No PII** stored in any storage layer
- Generation prompts stay under **2,000 input tokens**

---

<p align="center">
  <sub>Built with Cerebras inference and Cloudflare edge infrastructure</sub>
</p>

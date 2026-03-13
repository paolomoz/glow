# LLMO × Glow Integration

## Context

The LLM Optimizer (LLMO) team generates **verified prompts** from Citation Attempt data — real questions users ask ChatGPT that lead (or could lead) to brand page visits. Cedric's ask: extract these verified questions so AEM Sites/ASO can optimize visits. This is an industry-first for Summit.

## Data

- `prompt-suggestions-lovesac.csv` — Lovesac citation attempt prompts (91 rows)
- Next: Halliburton, Kellogg's

### Data Schema

| Field | Description |
|-------|-------------|
| `prompt` | The user question (e.g. "Couch with hidden speakers for home theater") |
| `topic` | Topic cluster (e.g. "Home theater sound and charging systems") |
| `category` | Site category (e.g. "Premium Modular Furniture") |
| `region` | Market (e.g. "US") |
| `intent` | LLMO intent type: informational, comparative, transactional, instructional, planning |
| `type` | branded vs unbranded |
| `Reasoning` | Why this prompt was generated, includes source URL and priority signals |
| `persona` | (empty in current data) |
| `url` | Source page the prompt maps to |
| `referral` | "referred" = ChatGPT sent traffic; "not referred" = citation attempt but no click-through |

## Integration Analysis

See [analysis.md](./analysis.md) for the deep-dive on Glow integration value and architecture.

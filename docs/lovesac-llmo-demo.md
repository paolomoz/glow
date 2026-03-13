# Lovesac + LLMO Demo

## Overview

This demo shows Glow's "From LLMO" capability: using verified ChatGPT prompts from the LLMO (LLM Optimizer) team to personalize lovesac.com instantly when a ChatGPT user lands on the page. Instead of waiting for behavioral signals, Glow already knows what the visitor asked ChatGPT and tailors the page accordingly.

## Architecture

LLMO prompts flow through the existing signal → intent → generation pipeline as **synthetic signals**, not a parallel path:

```
LLMO prompt JSON
  → panel imports + builds URL index
  → user selects a prompt
  → synthetic signals: page_visit (referrer=chatgpt.com) + search_query (prompt text)
  → SIGNAL_BATCH → intent engine → orchestrator → Cerebras → block injection
```

### Intent Mapping

| LLMO Intent    | Glow Archetype | Confidence |
|----------------|---------------|------------|
| informational  | explore       | 0.7        |
| comparative    | compare       | 0.8        |
| transactional  | seek_action   | 0.8        |
| instructional  | dive_deep     | 0.7        |
| planning       | explore       | 0.6        |

## Files

| File | Description |
|------|-------------|
| `data/www.lovesac.com-demo.json` | Content index: 39 atoms, 3 templates, brand profile |
| `llmo/lovesac-prompts.json` | 90 verified ChatGPT prompts (converted from CSV) |
| `llmo/prompt-index.ts` | Prompt index builder, URL lookup, intent mapping |
| `extension/panel/panel.html` | Added "From LLMO" button, prompt dropdown, import section |
| `extension/panel/panel.ts` | LLMO import handler, prompt selection, signal construction |
| `extension/background/messages.ts` | Added `'llmo'` to `GenerationSource` |
| `extension/background/service-worker.ts` | LLMO signal tracking per tab |
| `core/types.ts` | Extended `BlockReplacement.source` to include `'llmo'` |
| `extension/content-script/signals.ts` | Auto-detect `chatgpt.com` referrer |
| `test/e2e/lovesac-llmo-test.ts` | E2E test for the full LLMO flow |

## Manual Demo

### Prerequisites

- Node.js 20+
- Chrome browser
- Cerebras API key (built into the extension, or set via panel)

### Steps

1. **Build the extension:**
   ```bash
   npx vite build --config extension/vite.config.ts
   ```

2. **Load in Chrome:**
   - Navigate to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" → select `dist/extension/`

3. **Open https://www.lovesac.com** and click the Glow icon to open the side panel

4. **Import content index:**
   - Click "Import Index JSON" → select `data/www.lovesac.com-demo.json`

5. **Import LLMO prompts:**
   - Click "Import LLMO prompts JSON" → select `llmo/lovesac-prompts.json`
   - The prompt dropdown appears, filtered to prompts matching the current page URL

6. **Select a prompt** from the dropdown (e.g., `[comparative] Modular sectionals with built-in wireless chargers vs traditional sofas`)

7. **Click "From LLMO"** (orange button) → personalized blocks inject into the page with an orange source badge

### What to look for

- Hero section replaced with content tailored to the selected prompt
- Feature section updated with relevant product information
- StealthTech banner appears when prompt topics match (sound, speakers, charging)
- All generated blocks show "LLMO" source badge in the panel
- Block generation completes in <1s on warm Cerebras

## Automated E2E Test

```bash
npx tsx test/e2e/lovesac-llmo-test.ts
```

This runs headless Chrome with the extension, imports the index, sends LLMO signals, triggers generation, and verifies blocks have `source: 'llmo'`.

## Content Index Details

### Templates

| ID | Position | Selector | Topics Required |
|----|----------|----------|-----------------|
| `tmpl_lovesac_hero` | hero | `section:first-of-type` | none |
| `tmpl_lovesac_feature` | above-fold | `section:nth-of-type(2)` | none |
| `tmpl_lovesac_stealthtech_banner` | mid-page | `section:nth-of-type(3)` | stealthtech, sound, speakers, charging, etc. |

### Brand Profile

- **Voice**: warm, innovative, casual
- **Colors**: `#c17c3e` (amber), `#2d2926` (dark brown), `#f7f3ef` (cream)
- **Site type**: ecommerce
- **Guardrails**: no "cheap", "knockoff", "fake"; max 3 blocks per page

## LLMO Data

Source: `llmo/prompt-suggestions-lovesac.csv` (91 rows from LLMO team)
Converted: `llmo/lovesac-prompts.json` (90 valid prompts after filtering empty rows)

### URL Coverage

16 unique Lovesac URLs covered, including:
- Product pages (Sactionals configurations, BigOne, leather)
- StealthTech pages (setup, firmware, sound systems, satellite)
- Marketing pages (mailer, roadshow, trade program)

### Prompt Distribution

- **Intents**: informational, comparative, transactional, instructional, planning
- **Types**: branded, unbranded
- **6 prompts per URL** on average

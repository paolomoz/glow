# Glow Demo Script (~2 minutes)

**Audience:** Small engineering team, technical, informal
**Voice:** Chris (ElevenLabs), stability 0.15
**Setup:** Chrome with bmwusa.com open, Glow extension installed, demo index + ChatGPT conversation JSON ready

---

## INTRO (20s)

> Every website serves the same static page to everyone. Whether you're a tire-kicker or a ready-to-buy customer who just spent 20 minutes on ChatGPT researching German engineering — same hero, same CTAs. That's insane.

> Glow is a generative layer over any website. It rewrites blocks in real-time based on visitor intent. Not A/B testing — actual LLM-generated content, personalized, sub-2.5 seconds, grounded in the site's own content. Let me show you.

---

## LIVE DEMO

### Step 1 — Pick a site, load the index (15s)

*Open bmwusa.com, open Glow panel, import `www.bmwusa.com-demo.json`.*

> We pick bmwusa.com — nothing is BMW-specific, the system is site-agnostic. First we load a content index: 159 content atoms and 3 templates. In production the indexer builds this by crawling the site. For the demo we load a pre-built one.

### Step 2 — Browse and generate signals (15s)

*Scroll, hover, click a CTA.*

> Now I browse. Every action — scroll, hover, click — becomes a signal fed into the intent engine. Watch the panel: archetype shifting, confidence climbing. Five possible archetypes, zero LLM calls, under 100 milliseconds.

### Step 3 — Generate from signals (15s)

*Click "From Signals".*

> I hit Generate. Atoms get ranked by intent alignment, packed into a prompt with brand guardrails, Cerebras fills the slots — the page rewrites. Purple badges mean signal-generated. Check the timing — under 2.5 seconds.

### Step 4 — Load ChatGPT conversation (20s)

*Click Clear. Show the conversation briefly, then import `bmw-german-craftsmanship.json`.*

> Now the fun part. This visitor had a ChatGPT conversation about buying a German-built BMW — they care about Bavarian craftsmanship, they're leaning toward the 5 Series. Glow ingests this as intent signals — same pipeline, we parse messages into search queries and extract topic keywords.

### Step 5 — Generate from conversation (15s)

*Click "From ChatGPT".*

> Completely different content. The German Engineering banner appears with the Dingolfing factory image — that template has topic gates, it only fires when intent includes German engineering topics. Green badges mean conversation-generated. Same site, same system, radically different experience. That's Glow.

---

## KEY TECHNICAL POINTS (if Q&A)

- **Intent engine is zero-LLM** — rules + cosine similarity, <100ms
- **Cerebras generation** — GPT-OSS-120B, ~800ms per block
- **Content grounded** in indexed atoms — no hallucinated facts
- **Topic-gated templates** — `requiredTopics` controls which templates fire
- **In-place DOM modification** — CSS selector targeting, inline styles, no layout breakage

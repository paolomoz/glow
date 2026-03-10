# Adding Features

Step-by-step guides for common development tasks.

## 1. Add a New Signal Type

**Files to modify:**

| File | Change |
|------|--------|
| `core/types.ts` | Add to `SignalType` union |
| `core/intent/signals.ts` | Add normalization + aggregation logic |
| `extension/content-script/signals.ts` | Add DOM event listener |
| `snippet/loader.ts` | Add DOM event listener (production) |
| `test/core/pipeline.test.ts` | Add signal to test fixtures |

**Steps:**

1. Add the signal type to `core/types.ts`:
```typescript
export type SignalType =
  | 'page_visit'
  | 'scroll_depth'
  // ... existing types
  | 'my_new_signal';  // Add here
```

2. Add normalization in `core/intent/signals.ts` — add to the `VALID_SIGNAL_TYPES` set and handle in `normalize()`.

3. Add aggregation in `DefaultSignalAggregator.aggregate()` — decide which `AggregatedSignals` field this signal affects.

4. Add DOM capture in `extension/content-script/signals.ts` — attach event listener in `SignalCollector.start()`, emit signal via `this.emit()`.

5. Mirror the DOM capture in `snippet/loader.ts` for production mode.

6. Consider: should this signal contribute to the 6D feature vector? If yes, update `extractFeatures()` in `core/intent/engine.ts`.

**Reference file:** `extension/content-script/signals.ts` — see how `scroll_depth` is captured with throttling.

---

## 2. Add a New Intent Archetype

**Files to modify:**

| File | Change |
|------|--------|
| `core/types.ts` | Add to `IntentArchetype` union |
| `core/intent/archetypes.ts` | Add archetype profile with 6D weights |
| `core/retrieval/query-builder.ts` | Add to `ARCHETYPE_PURPOSE_MAP` |
| `core/generation/prompt-builder.ts` | Handle in user prompt construction |
| `core/pipeline/speculative.ts` | Add URL prediction patterns |
| `core/intent/engine.ts` | Add emotional register mapping |
| `test/core/pipeline.test.ts` | Add test cases |

**Steps:**

1. Add to `core/types.ts`:
```typescript
export type IntentArchetype = 'explore' | 'compare' | 'dive_deep' | 'seek_action' | 'return' | 'my_archetype';
```

2. Add profile in `core/intent/archetypes.ts`:
```typescript
my_archetype: {
  label: 'My Archetype',
  description: 'What this visitor behavior looks like',
  weights: {
    pagesVisitedDiversity: 0.5,  // 0-1: how much this dimension matters
    avgTimePerPage: 0.3,
    scrollDepthAvg: 0.4,
    ctaClickRate: 0.2,
    comparisonRate: 0.1,
    returnVisitRate: 0.1,
  },
},
```

3. Add purpose mapping in `core/retrieval/query-builder.ts`:
```typescript
my_archetype: ['inform', 'persuade'],  // which content purposes to retrieve
```

4. Add emotional register mapping in `core/intent/engine.ts` `inferEmotionalRegister()`.

5. Add speculative URL patterns in `core/pipeline/speculative.ts`.

**Reference file:** `core/intent/archetypes.ts` — see existing archetype definitions.

---

## 3. Add a New Skill Config (Website Type)

**Files to modify:**

| File | Change |
|------|--------|
| `skills/my-type.json` | New skill config file |
| `core/types.ts` | Add to `SiteType` union |
| `core/skills/loader.ts` | Add to `SITE_TYPE_SKILL_MAP` + `DEFAULT_SKILL_CONFIGS` |
| `core/skills/classifier.ts` | Add classification heuristics |

**Steps:**

1. Create `skills/my-type.json` following the schema in `skills/_schema.json`:
```json
{
  "siteType": "my-type",
  "signalWeights": {
    "page_visit": 1,
    "scroll_depth": 2,
    "click_target": 3
  },
  "intentOverrides": {
    "explore": { "indicators": ["browse", "discover"], "confidenceBoost": 0.1 }
  },
  "generationConstraints": {
    "maxBlocksPerPage": 3,
    "requiredDisclaimers": [],
    "forbiddenTopics": []
  },
  "promptModifiers": {
    "systemSuffix": "Additional instructions for this site type.",
    "toneOverride": null
  }
}
```

2. Add `'my-type'` to the `SiteType` union in `core/types.ts`.

3. Register in `core/skills/loader.ts`:
```typescript
const SITE_TYPE_SKILL_MAP: Record<SiteType, string> = {
  // ...existing
  'my-type': 'my-type',
};
```

4. Add classification heuristics in `core/skills/classifier.ts` — pattern-match on page content, meta tags, or URL structure.

5. Validate: `npx vitest run test/core/skills-analytics.test.ts`

**Reference file:** `skills/pharma.json` — most constrained skill config with disclaimers.

---

## 4. Add a New Storage Backend

**Files to create/modify:**

| File | Change |
|------|--------|
| New adapter file | Implement `StorageInterface` |
| Wire into consumer | Pass to `OrchestratorDeps` |

**Steps:**

1. Implement `StorageInterface` from `core/types.ts`:
```typescript
import type { StorageInterface, ContentAtom, BlockTemplate, BrandProfile, ContentMetadata, BlockPosition, AnalyticsEvent } from '@glow/core';

export class MyStorageAdapter implements StorageInterface {
  async queryAtoms(siteId: string, embedding: number[], filters: Partial<ContentMetadata>, limit: number): Promise<ContentAtom[]> { /* ... */ }
  async getTemplate(siteId: string, templateId: string): Promise<BlockTemplate | null> { /* ... */ }
  async getTemplatesForPosition(siteId: string, position: BlockPosition): Promise<BlockTemplate[]> { /* ... */ }
  async getBrandProfile(siteId: string): Promise<BrandProfile | null> { /* ... */ }
  async getCachedBlock(key: string): Promise<string | null> { /* ... */ }
  async setCachedBlock(key: string, html: string, ttlSeconds: number): Promise<void> { /* ... */ }
  async logEvent(event: AnalyticsEvent): Promise<void> { /* ... */ }
}
```

2. Pass to orchestrator:
```typescript
const orchestrator = new DefaultOrchestrator({
  intentEngine: new DefaultIntentEngine(),
  storage: new MyStorageAdapter(),
  cerebrasClient: new DefaultCerebrasClient(config),
  brandProfile: profile,
});
```

**Reference file:** `worker/storage/kv-adapter.ts` — production implementation.

---

## 5. Add a New Worker Route

**Files to modify:**

| File | Change |
|------|--------|
| `worker/routes/my-route.ts` | New route handler |
| `worker/index.ts` | Register route |
| `worker/env.ts` | Add bindings if needed |
| `test/worker/worker.test.ts` | Add tests |

**Steps:**

1. Create handler in `worker/routes/my-route.ts`:
```typescript
import type { Env } from '../env.js';

export async function handleMyRoute(request: Request, env: Env): Promise<Response> {
  // Implement handler
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

2. Register in `worker/index.ts` — add to the route matching logic.

3. Add bindings to `worker/env.ts` and `worker/wrangler.toml` if the route needs new storage.

**Reference file:** `worker/routes/blocks.ts` — most complex route (cache check → DO intent → orchestrator).

---

## 6. Add a New Generation Template

**Files to modify:**

| File | Change |
|------|--------|
| `core/types.ts` | Add to `GenerationTask` union |
| `core/generation/templates/my-task.ts` | New prompt template |
| `core/generation/model-router.ts` | Map task → model |
| `core/generation/prompt-builder.ts` | Handle new task in `buildUserPrompt()` |

**Steps:**

1. Add task type in `core/types.ts`:
```typescript
export type GenerationTask = 'content_fill' | 'layout_adapt' | 'atom_select' | 'compliance_check' | 'my_task';
```

2. Create template in `core/generation/templates/my-task.ts`:
```typescript
export const MY_TASK_SYSTEM = `You are a specialist for this task. Output valid JSON.`;
export const MY_TASK_USER = (context: string) => `Given this context:\n${context}\n\nGenerate output.`;
```

3. Add model routing in `core/generation/model-router.ts`:
```typescript
export const DEFAULT_MODEL_MAP: Record<GenerationTask, GenerationModel> = {
  // ...existing
  my_task: 'glm-4.7-flash',
};
```

4. Handle in `core/generation/prompt-builder.ts` `buildUserPrompt()` — add case for the new task.

**Reference file:** `core/generation/templates/content-fill.ts` — standard template pattern.

---

## 7. Add a New Debug Panel Component (Extension)

**Files to modify:**

| File | Change |
|------|--------|
| `extension/panel/components/my-component.ts` | New component |
| `extension/panel/panel.ts` | Import and mount |
| `extension/panel/panel.html` | Add container element |
| `extension/background/service-worker.ts` | Broadcast new data type if needed |

**Steps:**

1. Create component in `extension/panel/components/my-component.ts` — export a class that accepts a container element and has an `update(data)` method.

2. Add container in `extension/panel/panel.html`:
```html
<div id="my-component" class="panel-section"></div>
```

3. Mount in `extension/panel/panel.ts` — instantiate and wire to panel message handler.

4. If needed, add a new broadcast type in `extension/background/service-worker.ts`.

**Reference file:** `extension/panel/components/intent-meter.ts` — simplest component.

---

## 8. Modify Atom Scoring Weights

**Files to modify:**

| File | Change |
|------|--------|
| `core/retrieval/atom-selector.ts` | Adjust `DEFAULT_WEIGHTS` or scoring functions |
| `test/core/pipeline.test.ts` | Verify ranking behavior |

**Current weights:**

```typescript
const DEFAULT_WEIGHTS: ScoringWeights = {
  semanticSimilarity: 0.4,   // Embedding cosine similarity
  intentAlignment: 0.3,      // Purpose + audience + register match
  freshness: 0.15,           // Decay over 90 days
  performanceHistory: 0.15,  // Engagement + conversion + reliability
};
```

To adjust: modify the weights object. All weights should sum to 1.0.

To change the freshness decay window: modify the `freshness()` function (currently `1 - ageDays / 90`).

To change performance scoring: modify `performanceHistory()` — currently `0.4 * engagement + 0.4 * conversion + 0.2 * reliability`.

**Reference file:** `core/retrieval/atom-selector.ts` — complete scoring implementation.

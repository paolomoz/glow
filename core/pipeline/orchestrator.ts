// core/pipeline/orchestrator.ts — Main pipeline: signals → personalized blocks
// CC-2.4.1 to CC-2.4.4: Intent → Retrieval → Generation with budget enforcement

import type {
  Signal,
  IntentVector,
  PipelineResult,
  BlockReplacement,
  BlockPosition,
  ContentAtom,
  BlockTemplate,
  BrandProfile,
  StorageInterface,
  GenerationModel,
} from '../types.js';
import {
  MAX_GENERATION_TIME_MS,
  MIN_CONFIDENCE_THRESHOLD,
  MODERATE_CONFIDENCE_THRESHOLD,
} from '../types.js';
import type { IntentEngine } from '../intent/engine.js';
import { getPersonalizationLevel, getMaxBlocksForLevel } from '../intent/progressive.js';
import type { CerebrasClient, CompletionResponse } from '../generation/cerebras-client.js';
import { DefaultModelRouter } from '../generation/model-router.js';
import { DefaultPromptBuilder } from '../generation/prompt-builder.js';
import { DefaultAtomSelector } from '../retrieval/atom-selector.js';
import { DefaultQueryBuilder } from '../retrieval/query-builder.js';
import { DefaultBlockAssembler } from '../blocks/assembler.js';
import { TimeBudget } from './timeout.js';

/**
 * Main pipeline: signals in → personalized blocks out.
 * Coordinates intent → retrieval → generation within the 2.5s budget.
 */
export interface Orchestrator {
  process(
    siteId: string,
    sessionId: string,
    pageUrl: string,
    signals: Signal[]
  ): Promise<PipelineResult>;
}

/** Dependencies for the pipeline orchestrator. */
export interface OrchestratorDeps {
  intentEngine: IntentEngine;
  storage: StorageInterface;
  cerebrasClient: CerebrasClient;
  brandProfile: BrandProfile;
}

/**
 * Default pipeline orchestrator.
 * Wires intent → retrieval → generation with parallel execution and budget enforcement.
 */
export class DefaultOrchestrator implements Orchestrator {
  private deps: OrchestratorDeps;
  private modelRouter = new DefaultModelRouter();
  private promptBuilder = new DefaultPromptBuilder();
  private atomSelector = new DefaultAtomSelector();
  private queryBuilder = new DefaultQueryBuilder();
  private assembler = new DefaultBlockAssembler();

  /** Session-scoped cache for speculative pre-generation. */
  private cache = new Map<string, { html: string; expiry: number }>();

  /** Session-scoped intent state. */
  private intentState = new Map<string, IntentVector>();

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  async process(
    siteId: string,
    sessionId: string,
    pageUrl: string,
    signals: Signal[],
  ): Promise<PipelineResult> {
    const budget = new TimeBudget(MAX_GENERATION_TIME_MS);
    const startTime = Date.now();

    // Step 1: Update intent state from signals
    const currentIntent = this.intentState.get(sessionId) ?? null;
    const intent = this.deps.intentEngine.ingestSignals(currentIntent, signals);
    this.intentState.set(sessionId, intent);

    // Step 2: Check confidence threshold — if too low, return empty
    if (intent.confidence < MIN_CONFIDENCE_THRESHOLD) {
      return {
        blocks: [],
        intent,
        totalTimeMs: Date.now() - startTime,
        cacheHit: false,
      };
    }

    // Step 3: Check speculative cache
    const cacheKey = buildCacheKey(sessionId, pageUrl, intent.archetype);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return {
        blocks: [
          {
            selector: 'main',
            html: cached,
            templateId: 'cached',
            atomIds: [],
            generationTimeMs: 0,
            model: 'glm-4.7-flash',
            confidence: intent.confidence,
          },
        ],
        intent,
        totalTimeMs: Date.now() - startTime,
        cacheHit: true,
      };
    }

    // Step 4: Determine personalization level
    const level = getPersonalizationLevel(intent.confidence);
    const maxBlocks = getMaxBlocksForLevel(level);

    // Step 5: Retrieve atoms and templates in parallel
    const query = this.queryBuilder.build(siteId, intent);

    const [retrievedAtoms, templates] = await Promise.all([
      this.deps.storage.queryAtoms(
        siteId,
        intent.topicEmbedding,
        query.metadataFilters,
        query.limit,
      ),
      this.getTemplatesForPage(siteId, pageUrl),
    ]);

    if (budget.isExpired) {
      return {
        blocks: [],
        intent,
        totalTimeMs: Date.now() - startTime,
        cacheHit: false,
      };
    }

    // Step 6: Rank and select atoms
    const selectedAtoms = this.atomSelector.select(
      retrievedAtoms,
      intent,
      maxBlocks * 3, // Get extra atoms for selection variety
    );

    // Step 7: Generate blocks in parallel (up to maxBlocks)
    const blocksToGenerate = templates.slice(0, maxBlocks);
    const blockPromises = blocksToGenerate.map((template) =>
      this.generateBlock(
        template,
        selectedAtoms,
        intent,
        budget,
      ),
    );

    // CC-2.4.3: Return blocks as they complete
    const results = await Promise.allSettled(blockPromises);
    const blocks: BlockReplacement[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        blocks.push(result.value);
      }
    }

    return {
      blocks,
      intent,
      totalTimeMs: Date.now() - startTime,
      cacheHit: false,
    };
  }

  /** Generate a single personalized block. */
  private async generateBlock(
    template: BlockTemplate,
    atoms: ContentAtom[],
    intent: IntentVector,
    budget: TimeBudget,
  ): Promise<BlockReplacement | null> {
    if (budget.isExpired) return null;

    const genStartTime = Date.now();
    const remainingMs = budget.remainingMs;

    // CC-2.4.4: If less than 500ms remaining, skip
    if (remainingMs < 500) return null;

    // Route to the appropriate model
    const routing = this.modelRouter.route('content_fill', remainingMs);

    // Build the prompt
    const prompt = this.promptBuilder.build(
      'content_fill',
      atoms,
      template.slots,
      intent,
      this.deps.brandProfile,
    );

    try {
      // Call the LLM
      const response = await this.deps.cerebrasClient.complete(
        {
          model: routing.model,
          messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: prompt.userPrompt },
          ],
          maxTokens: 500,
          temperature: 0.7,
        },
        budget.createAbortSignal(),
      );

      // Parse the response into slot values
      const filledSlots = parseSlotResponse(response.content);

      // Assemble the final HTML
      const html = this.assembler.assemble(
        template,
        filledSlots,
        template.cssRules,
      );

      return {
        selector: `[data-template-id="${template.id}"]`,
        html,
        templateId: template.id,
        atomIds: atoms.map((a) => a.id),
        generationTimeMs: Date.now() - genStartTime,
        model: routing.model,
        confidence: intent.confidence,
      };
    } catch {
      // Generation failed (timeout, API error, etc.) — skip this block
      return null;
    }
  }

  /** Get templates relevant to the current page. */
  private async getTemplatesForPage(
    siteId: string,
    _pageUrl: string,
  ): Promise<BlockTemplate[]> {
    // Get templates for common positions
    const positions: BlockPosition[] = [
      'hero',
      'above-fold',
      'mid-page',
    ];

    const templatePromises = positions.map((pos) =>
      this.deps.storage.getTemplatesForPosition(siteId, pos),
    );

    const results = await Promise.all(templatePromises);
    return results.flat();
  }

  /** Get from speculative cache. */
  private getFromCache(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.html;
  }

  /** Set in speculative cache with TTL. */
  setCache(key: string, html: string, ttlMs: number): void {
    this.cache.set(key, { html, expiry: Date.now() + ttlMs });
  }

  /** Clear expired cache entries. */
  cleanCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCacheKey(
  sessionId: string,
  pageUrl: string,
  archetype: string,
): string {
  return `${sessionId}:${pageUrl}:${archetype}`;
}

/** Parse LLM response content as slot key-value pairs. */
function parseSlotResponse(content: string): Record<string, string> {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Ensure all values are strings
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = String(value);
      }
      return result;
    }
  } catch {
    // Fall through to empty
  }
  return {};
}

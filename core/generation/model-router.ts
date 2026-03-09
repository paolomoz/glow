// core/generation/model-router.ts — Select model based on task and budget
// CC-2.3.2: Route tasks to appropriate models with urgency-based fallback

import type { GenerationModel, GenerationTask } from '../types.js';

export interface ModelRoutingDecision {
  model: GenerationModel;
  reason: string;
  fallback: GenerationModel;
}

/**
 * Selects the appropriate model based on the generation task and available budget.
 */
export interface ModelRouter {
  route(task: GenerationTask, remainingBudgetMs: number): ModelRoutingDecision;
}

/** Default task-to-model mapping. */
export const DEFAULT_MODEL_MAP: Record<GenerationTask, GenerationModel> = {
  content_fill: 'gpt-oss-120b',
  layout_adapt: 'glm-4.7',
  atom_select: 'glm-4.7-flash',
  compliance_check: 'glm-4.7-flash',
};

/** Fallback chain when primary model is unavailable or too slow. */
export const FALLBACK_CHAIN: GenerationModel[] = [
  'gpt-oss-120b',
  'glm-4.7',
  'glm-4.7-flash',
  'llama-3.3-8b',
];

/**
 * Estimated latency per model in ms (p50 for typical requests).
 * Used to decide whether the budget allows using a given model.
 */
const MODEL_LATENCY_ESTIMATES: Record<GenerationModel, number> = {
  'gpt-oss-120b': 1200,
  'glm-4.7': 800,
  'glm-4.7-flash': 400,
  'llama-3.3-8b': 600,
};

/**
 * Default model router implementation.
 * Selects the best model for the task based on remaining time budget.
 * If the budget is tight, downgrades to a faster model.
 */
export class DefaultModelRouter implements ModelRouter {
  private modelMap: Record<GenerationTask, GenerationModel>;

  constructor(
    modelMap: Partial<Record<GenerationTask, GenerationModel>> = {},
  ) {
    this.modelMap = { ...DEFAULT_MODEL_MAP, ...modelMap };
  }

  route(
    task: GenerationTask,
    remainingBudgetMs: number,
  ): ModelRoutingDecision {
    const preferredModel = this.modelMap[task];
    const estimatedLatency = MODEL_LATENCY_ESTIMATES[preferredModel];

    // If we have enough budget, use the preferred model
    if (remainingBudgetMs >= estimatedLatency * 1.2) {
      const fallback = this.findFallback(preferredModel);
      return {
        model: preferredModel,
        reason: `Default model for ${task} with sufficient budget (${remainingBudgetMs}ms remaining)`,
        fallback,
      };
    }

    // Budget is tight — find a faster model
    const downgraded = this.findFastestModel(remainingBudgetMs);
    return {
      model: downgraded,
      reason: `Downgraded from ${preferredModel} due to tight budget (${remainingBudgetMs}ms remaining)`,
      fallback: this.findFallback(downgraded),
    };
  }

  /** Find the next model in the fallback chain after the given model. */
  private findFallback(model: GenerationModel): GenerationModel {
    const idx = FALLBACK_CHAIN.indexOf(model);
    if (idx >= 0 && idx < FALLBACK_CHAIN.length - 1) {
      return FALLBACK_CHAIN[idx + 1];
    }
    return FALLBACK_CHAIN[FALLBACK_CHAIN.length - 1];
  }

  /** Find the fastest model that fits within the budget. */
  private findFastestModel(budgetMs: number): GenerationModel {
    // Walk the fallback chain from fastest to find one that fits
    const sorted = [...FALLBACK_CHAIN].sort(
      (a, b) => MODEL_LATENCY_ESTIMATES[a] - MODEL_LATENCY_ESTIMATES[b],
    );

    for (const model of sorted) {
      if (MODEL_LATENCY_ESTIMATES[model] <= budgetMs) {
        return model;
      }
    }

    // If nothing fits, use the fastest available
    return sorted[0];
  }
}

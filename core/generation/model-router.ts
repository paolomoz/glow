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

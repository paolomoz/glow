// Core barrel export — all public types, interfaces, and implementations
export * from './types.js';

// Intent engine
export type { IntentEngine } from './intent/engine.js';
export { DefaultIntentEngine } from './intent/engine.js';
export type { SignalNormalizer, SignalAggregator, AggregatedSignals } from './intent/signals.js';
export { DefaultSignalNormalizer, DefaultSignalAggregator } from './intent/signals.js';
export type { ProgressivePersonalization } from './intent/progressive.js';
export {
  DefaultProgressivePersonalization,
  getPersonalizationLevel,
  getMaxBlocksForLevel,
} from './intent/progressive.js';
export { ARCHETYPE_PROFILES } from './intent/archetypes.js';

// Retrieval
export type { QueryBuilder, RetrievalQuery } from './retrieval/query-builder.js';
export { DefaultQueryBuilder } from './retrieval/query-builder.js';
export type { AtomSelector, RankedAtom, ScoringWeights } from './retrieval/atom-selector.js';
export { DefaultAtomSelector, cosineSimilarity } from './retrieval/atom-selector.js';

// Generation
export type { CerebrasClient, CerebrasConfig, CompletionRequest, CompletionResponse } from './generation/cerebras-client.js';
export { DefaultCerebrasClient, CerebrasApiError, CEREBRAS_BASE_URL, MODEL_IDS } from './generation/cerebras-client.js';
export type { ModelRouter, ModelRoutingDecision } from './generation/model-router.js';
export { DefaultModelRouter, DEFAULT_MODEL_MAP, FALLBACK_CHAIN } from './generation/model-router.js';
export type { PromptBuilder, PromptComponents } from './generation/prompt-builder.js';
export { DefaultPromptBuilder } from './generation/prompt-builder.js';

// Blocks
export type { BlockRegistry } from './blocks/registry.js';
export { DefaultBlockRegistry } from './blocks/registry.js';
export type { SlotFiller, FilledSlots } from './blocks/slot-filler.js';
export { DefaultSlotFiller } from './blocks/slot-filler.js';
export type { BlockAssembler } from './blocks/assembler.js';
export { DefaultBlockAssembler } from './blocks/assembler.js';
export { wrapWithBadge } from './blocks/badge.js';

// Pipeline
export type { Orchestrator, OrchestratorDeps } from './pipeline/orchestrator.js';
export { DefaultOrchestrator } from './pipeline/orchestrator.js';
export { TimeBudget } from './pipeline/timeout.js';
export type { SpeculativePreGenerator, PredictedPage } from './pipeline/speculative.js';
export { DefaultSpeculativePreGenerator } from './pipeline/speculative.js';

// Skills
export type { SiteClassifier, ClassificationResult } from './skills/classifier.js';
export { classifySiteType } from './skills/classifier.js';
export type { SkillLoader } from './skills/loader.js';
export { getSkillConfigName, getAvailableSkillNames, loadDefaultSkillConfig, DEFAULT_SKILL_CONFIGS } from './skills/loader.js';

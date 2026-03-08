// Core barrel export — all public types and interfaces
export * from './types.js';
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
export type { QueryBuilder } from './retrieval/query-builder.js';
export type { AtomSelector } from './retrieval/atom-selector.js';
export type { CerebrasClient } from './generation/cerebras-client.js';
export type { ModelRouter } from './generation/model-router.js';
export type { PromptBuilder } from './generation/prompt-builder.js';
export type { BlockRegistry } from './blocks/registry.js';
export type { SlotFiller } from './blocks/slot-filler.js';
export type { BlockAssembler } from './blocks/assembler.js';
export type { Orchestrator } from './pipeline/orchestrator.js';

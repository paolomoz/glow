import type {
  BrandProfile,
  ContentAtom,
  IntentVector,
  SlotDefinition,
  GenerationTask,
} from '../types.js';

export interface PromptComponents {
  systemPrompt: string;
  userPrompt: string;
  estimatedTokens: number;
}

/**
 * Assembles generation prompts from brand brief + intent + template + atoms.
 * Total prompt must stay under MAX_INPUT_TOKENS (2000) for speed.
 */
export interface PromptBuilder {
  build(
    task: GenerationTask,
    atoms: ContentAtom[],
    slots: SlotDefinition[],
    intent: IntentVector,
    brand: BrandProfile
  ): PromptComponents;
}

import type { BlockTemplate, GenerationResponse } from '../types.js';
import type { FilledSlots } from './slot-filler.js';

/**
 * Produces final HTML from a filled block template, including
 * inline styles and the AI provenance badge.
 */
export interface BlockAssembler {
  assemble(
    template: BlockTemplate,
    filledSlots: FilledSlots,
    cssRules: string
  ): string;
}

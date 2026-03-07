import type { SlotDefinition } from '../types.js';

export interface FilledSlots {
  [slotName: string]: string;
}

/**
 * Maps generated content into template slot placeholders.
 */
export interface SlotFiller {
  fill(htmlShell: string, slots: SlotDefinition[], filledValues: FilledSlots): string;
  validate(slots: SlotDefinition[], filledValues: FilledSlots): string[];
}

// core/blocks/slot-filler.ts — Fill template slots with generated content
// Maps generated content into template slot placeholders

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

/**
 * Default slot filler. Replaces {{slotName}} placeholders in the HTML shell
 * with provided values, enforcing slot constraints.
 */
export class DefaultSlotFiller implements SlotFiller {
  /**
   * Replace slot placeholders in the HTML shell with filled values.
   * Placeholders are in the format {{slotName}}.
   */
  fill(
    htmlShell: string,
    slots: SlotDefinition[],
    filledValues: FilledSlots,
  ): string {
    let result = htmlShell;

    for (const slot of slots) {
      const placeholder = `{{${slot.name}}}`;
      const value = filledValues[slot.name];

      if (value !== undefined) {
        // Enforce maxLength constraint
        const maxLen = slot.constraints.maxLength;
        const trimmedValue = maxLen && value.length > maxLen
          ? value.slice(0, maxLen)
          : value;

        result = result.replaceAll(placeholder, escapeHtml(trimmedValue));
      } else if (slot.constraints.required) {
        // Required slot not filled — use original content as fallback
        result = result.replaceAll(placeholder, escapeHtml(slot.originalContent));
      }
    }

    return result;
  }

  /**
   * Validate filled values against slot constraints.
   * Returns an array of validation error messages (empty = valid).
   */
  validate(
    slots: SlotDefinition[],
    filledValues: FilledSlots,
  ): string[] {
    const errors: string[] = [];

    for (const slot of slots) {
      const value = filledValues[slot.name];

      if (value === undefined || value === '') {
        if (slot.constraints.required) {
          errors.push(`Missing required slot: ${slot.name}`);
        }
        continue;
      }

      const minLen = slot.constraints.minLength;
      if (minLen && value.length < minLen) {
        errors.push(
          `Slot "${slot.name}" too short: ${value.length} < ${minLen}`,
        );
      }

      const maxLen = slot.constraints.maxLength;
      if (maxLen && value.length > maxLen) {
        errors.push(
          `Slot "${slot.name}" too long: ${value.length} > ${maxLen}`,
        );
      }

      if (slot.constraints.pattern) {
        const regex = new RegExp(slot.constraints.pattern);
        if (!regex.test(value)) {
          errors.push(
            `Slot "${slot.name}" does not match pattern: ${slot.constraints.pattern}`,
          );
        }
      }
    }

    return errors;
  }
}

/** Escape HTML entities to prevent XSS in slot content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

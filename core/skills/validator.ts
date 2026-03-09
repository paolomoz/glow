// core/skills/validator.ts — Runtime validation for skill configs
// CC-5.1: Validates skill configs against the schema at runtime

import type { SkillConfig } from '../types.js';

const VALID_SITE_TYPES = ['pharma', 'ecommerce', 'saas', 'media', 'corporate', 'other'];
const VALID_SIGNAL_TYPES = [
  'page_visit', 'scroll_depth', 'click_target', 'hover_dwell',
  'search_query', 'filter_select', 'navigation', 'time_on_section',
  'form_interaction', 'viewport_block_visibility',
];
const VALID_ARCHETYPES = ['explore', 'compare', 'dive_deep', 'seek_action', 'return'];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a skill config object at runtime.
 * Returns validation result with error messages.
 */
export function validateSkillConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be a non-null object'] };
  }

  const c = config as Record<string, unknown>;

  // Required fields
  if (!c.siteType || typeof c.siteType !== 'string') {
    errors.push('siteType is required and must be a string');
  } else if (!VALID_SITE_TYPES.includes(c.siteType)) {
    errors.push(`siteType must be one of: ${VALID_SITE_TYPES.join(', ')}`);
  }

  // Signal weights
  if (c.signalWeights !== undefined) {
    if (typeof c.signalWeights !== 'object' || c.signalWeights === null) {
      errors.push('signalWeights must be an object');
    } else {
      for (const [key, value] of Object.entries(c.signalWeights as Record<string, unknown>)) {
        if (!VALID_SIGNAL_TYPES.includes(key)) {
          errors.push(`Invalid signal type in signalWeights: ${key}`);
        }
        if (typeof value !== 'number' || value < 0 || value > 5) {
          errors.push(`signalWeights.${key} must be a number between 0 and 5`);
        }
      }
    }
  }

  // Intent overrides
  if (c.intentOverrides !== undefined) {
    if (typeof c.intentOverrides !== 'object' || c.intentOverrides === null) {
      errors.push('intentOverrides must be an object');
    } else {
      const io = c.intentOverrides as Record<string, unknown>;

      if (io.archetypeIndicators && typeof io.archetypeIndicators === 'object') {
        for (const key of Object.keys(io.archetypeIndicators as Record<string, unknown>)) {
          if (!VALID_ARCHETYPES.includes(key)) {
            errors.push(`Invalid archetype in archetypeIndicators: ${key}`);
          }
        }
      }
    }
  }

  // Generation constraints
  if (c.generationConstraints !== undefined) {
    if (typeof c.generationConstraints !== 'object' || c.generationConstraints === null) {
      errors.push('generationConstraints must be an object');
    } else {
      const gc = c.generationConstraints as Record<string, unknown>;

      if (gc.maxBlocksPerPage !== undefined) {
        if (typeof gc.maxBlocksPerPage !== 'number' || gc.maxBlocksPerPage < 0 || gc.maxBlocksPerPage > 10) {
          errors.push('maxBlocksPerPage must be a number between 0 and 10');
        }
      }

      if (gc.forbiddenTopics !== undefined && !Array.isArray(gc.forbiddenTopics)) {
        errors.push('forbiddenTopics must be an array');
      }

      if (gc.requiredDisclaimers !== undefined) {
        if (!Array.isArray(gc.requiredDisclaimers)) {
          errors.push('requiredDisclaimers must be an array');
        } else {
          for (let i = 0; i < gc.requiredDisclaimers.length; i++) {
            const d = gc.requiredDisclaimers[i] as Record<string, unknown>;
            if (!d.trigger || typeof d.trigger !== 'string') {
              errors.push(`requiredDisclaimers[${i}].trigger is required`);
            }
            if (!d.text || typeof d.text !== 'string') {
              errors.push(`requiredDisclaimers[${i}].text is required`);
            }
          }
        }
      }
    }
  }

  // Prompt modifiers
  if (c.promptModifiers !== undefined) {
    if (typeof c.promptModifiers !== 'object' || c.promptModifiers === null) {
      errors.push('promptModifiers must be an object');
    } else {
      const pm = c.promptModifiers as Record<string, unknown>;
      if (pm.systemSuffix !== undefined && typeof pm.systemSuffix !== 'string') {
        errors.push('promptModifiers.systemSuffix must be a string');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

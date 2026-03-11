import {
  MIN_CONFIDENCE_THRESHOLD,
  MODERATE_CONFIDENCE_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
} from '../types.js';

/**
 * Personalization levels based on confidence thresholds.
 * The longer a user browses, the more confident the system becomes,
 * and the more aggressive the personalization.
 */
export type PersonalizationLevel = 'none' | 'subtle' | 'moderate' | 'full';

export interface ProgressivePersonalization {
  /** Determine the personalization level from a confidence score. */
  getLevel(confidence: number): PersonalizationLevel;

  /** Get the max number of blocks to replace at this level. */
  getMaxBlocks(level: PersonalizationLevel): number;
}

export function getPersonalizationLevel(confidence: number): PersonalizationLevel {
  if (confidence < MIN_CONFIDENCE_THRESHOLD) return 'none';
  if (confidence < MODERATE_CONFIDENCE_THRESHOLD) return 'subtle';
  if (confidence < HIGH_CONFIDENCE_THRESHOLD) return 'moderate';
  return 'full';
}

export function getMaxBlocksForLevel(level: PersonalizationLevel): number {
  switch (level) {
    case 'none':
      return 0;
    case 'subtle':
      return 1;
    case 'moderate':
      return 3;
    case 'full':
      return 5;
  }
}

/**
 * Default implementation of progressive personalization.
 */
export class DefaultProgressivePersonalization implements ProgressivePersonalization {
  getLevel(confidence: number): PersonalizationLevel {
    return getPersonalizationLevel(confidence);
  }

  getMaxBlocks(level: PersonalizationLevel): number {
    return getMaxBlocksForLevel(level);
  }
}

import type { SkillConfig } from '../types.js';

/**
 * Loads and applies website-type skill configurations.
 */
export interface SkillLoader {
  load(siteType: string): Promise<SkillConfig | null>;
  getAvailableSkills(): string[];
}

// core/skills/loader.ts — Load and apply website-type skill configurations
// CC-1.5.5: Map classified site type to skill config file

import type { SkillConfig, SiteType } from '../types.js';

/**
 * Loads and applies website-type skill configurations.
 */
export interface SkillLoader {
  load(siteType: string): Promise<SkillConfig | null>;
  getAvailableSkills(): string[];
}

/** Maps site types to their default skill config file names. */
const SITE_TYPE_SKILL_MAP: Record<SiteType, string> = {
  pharma: 'pharma',
  ecommerce: 'ecommerce',
  saas: 'saas',
  media: 'media',
  corporate: 'corporate',
  other: 'generic',
};

/**
 * Get the skill config file name for a given site type.
 */
export function getSkillConfigName(siteType: SiteType): string {
  return SITE_TYPE_SKILL_MAP[siteType] ?? 'generic';
}

/**
 * Get all available skill config names.
 */
export function getAvailableSkillNames(): string[] {
  return Object.values(SITE_TYPE_SKILL_MAP);
}

/**
 * Built-in default skill configs used when no JSON config file is available.
 * These provide sensible defaults for each site type.
 */
export const DEFAULT_SKILL_CONFIGS: Record<string, SkillConfig> = {
  pharma: {
    siteType: 'pharma',
    signalWeights: {
      click_target: 1.5,
      time_on_section: 1.5,
      scroll_depth: 1.0,
      search_query: 2.0,
    },
    intentOverrides: {
      archetypeIndicators: {
        dive_deep: ['prescribing information', 'clinical data', 'safety'],
        seek_action: ['find a doctor', 'patient support', 'copay'],
      },
      confidenceBoosts: {
        hcp_indicator: 0.2,
      },
    },
    generationConstraints: {
      maxBlocksPerPage: 1,
      requiredDisclaimers: [
        {
          trigger: 'drug_mention',
          text: 'Please see full Prescribing Information, including Boxed WARNING.',
        },
      ],
      forbiddenTopics: ['off-label use', 'competitor comparison', 'pricing guarantee'],
      audienceDetection: [
        { signal: 'hcp_url', audience: 'hcp', action: 'show_clinical_data' },
        { signal: 'patient_url', audience: 'patient', action: 'show_support' },
      ],
    },
    promptModifiers: {
      systemSuffix:
        'You MUST include required safety disclaimers. NEVER make claims not supported by the prescribing information. All generated content must be fair-balanced.',
    },
  },
  ecommerce: {
    siteType: 'ecommerce',
    signalWeights: {
      click_target: 1.5,
      filter_select: 2.0,
      search_query: 2.0,
      scroll_depth: 0.8,
    },
    intentOverrides: {
      archetypeIndicators: {
        compare: ['filter', 'sort', 'versus', 'compare'],
        seek_action: ['add to cart', 'buy', 'checkout'],
      },
      confidenceBoosts: {},
    },
    generationConstraints: {
      maxBlocksPerPage: 3,
      requiredDisclaimers: [],
      forbiddenTopics: [],
      audienceDetection: [],
    },
    promptModifiers: {
      systemSuffix:
        'Focus on product benefits and features. Use the brand voice. Do not invent product details not found in the content index.',
    },
  },
  saas: {
    siteType: 'saas',
    signalWeights: {
      page_visit: 1.0,
      click_target: 1.2,
      scroll_depth: 1.0,
      time_on_section: 1.3,
    },
    intentOverrides: {
      archetypeIndicators: {
        compare: ['pricing', 'plans', 'versus'],
        dive_deep: ['docs', 'api', 'integration'],
        seek_action: ['demo', 'trial', 'sign up'],
      },
      confidenceBoosts: {},
    },
    generationConstraints: {
      maxBlocksPerPage: 3,
      requiredDisclaimers: [],
      forbiddenTopics: [],
      audienceDetection: [],
    },
    promptModifiers: {
      systemSuffix:
        'Emphasize value proposition and use cases. Match the technical depth to the inferred audience.',
    },
  },
  media: {
    siteType: 'media',
    signalWeights: {
      scroll_depth: 1.5,
      time_on_section: 1.5,
      click_target: 1.0,
      page_visit: 0.8,
    },
    intentOverrides: {
      archetypeIndicators: {
        explore: ['homepage', 'trending', 'latest'],
        dive_deep: ['article', 'longread', 'analysis'],
      },
      confidenceBoosts: {},
    },
    generationConstraints: {
      maxBlocksPerPage: 2,
      requiredDisclaimers: [],
      forbiddenTopics: [],
      audienceDetection: [],
    },
    promptModifiers: {
      systemSuffix:
        'Content must be factual and grounded in indexed articles. Do not generate opinions or editorials.',
    },
  },
  corporate: {
    siteType: 'corporate',
    signalWeights: {
      page_visit: 1.0,
      click_target: 1.0,
      scroll_depth: 1.0,
    },
    intentOverrides: {
      archetypeIndicators: {
        explore: ['about', 'values', 'team'],
        seek_action: ['careers', 'contact', 'investor'],
      },
      confidenceBoosts: {},
    },
    generationConstraints: {
      maxBlocksPerPage: 2,
      requiredDisclaimers: [],
      forbiddenTopics: [],
      audienceDetection: [],
    },
    promptModifiers: {
      systemSuffix:
        'Maintain a professional, authoritative tone consistent with the corporate brand.',
    },
  },
  generic: {
    siteType: 'other',
    signalWeights: {},
    intentOverrides: {
      archetypeIndicators: {},
      confidenceBoosts: {},
    },
    generationConstraints: {
      maxBlocksPerPage: 3,
      requiredDisclaimers: [],
      forbiddenTopics: [],
      audienceDetection: [],
    },
    promptModifiers: {
      systemSuffix: 'Match the tone and style of the existing site content.',
    },
  },
};

/**
 * Load a skill config by site type name.
 * Falls back to built-in defaults when no external config is available.
 */
export function loadDefaultSkillConfig(siteType: string): SkillConfig | null {
  return DEFAULT_SKILL_CONFIGS[siteType] ?? DEFAULT_SKILL_CONFIGS['generic'] ?? null;
}

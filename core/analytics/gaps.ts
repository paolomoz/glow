// core/analytics/gaps.ts — Gap analysis for content and template quality
// CC-6.3: Identify underserved intents, poor-performing templates, audience gaps

import type {
  IntentArchetype,
  BlockPosition,
  ContentAtom,
  BlockTemplate,
  AnalyticsEvent,
} from '../types.js';

export interface ContentGap {
  intentPattern: IntentArchetype;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface TemplateGap {
  position: BlockPosition;
  templateId?: string;
  engagementRate: number;
  description: string;
}

export interface AudienceGap {
  audienceMode: string;
  contentDepth: string;
  availableAtoms: number;
  description: string;
}

/**
 * Identifies intent patterns with poor content matches
 * and block templates with consistently poor engagement.
 */
export interface GapAnalyzer {
  findContentGaps(atoms: ContentAtom[], events: AnalyticsEvent[]): ContentGap[];
  findTemplateGaps(templates: BlockTemplate[], events: AnalyticsEvent[]): TemplateGap[];
  findAudienceGaps(atoms: ContentAtom[]): AudienceGap[];
}

/**
 * Default gap analyzer that surfaces quality and coverage issues.
 */
export class DefaultGapAnalyzer implements GapAnalyzer {
  /**
   * Find intent patterns with low-quality content matches.
   */
  findContentGaps(
    atoms: ContentAtom[],
    events: AnalyticsEvent[],
  ): ContentGap[] {
    const gaps: ContentGap[] = [];

    // Track per-archetype engagement
    const archetypeStats = new Map<string, { impressions: number; interactions: number }>();

    for (const event of events) {
      if (!event.isGenerative) continue;
      const archetype = (event.data.archetype as string) ?? 'unknown';
      const stats = archetypeStats.get(archetype) ?? { impressions: 0, interactions: 0 };

      if (event.type === 'impression') stats.impressions++;
      if (event.type === 'interaction') stats.interactions++;

      archetypeStats.set(archetype, stats);
    }

    // Flag archetypes with low engagement rates
    const archetypes: IntentArchetype[] = ['explore', 'compare', 'dive_deep', 'seek_action', 'return'];

    for (const archetype of archetypes) {
      const stats = archetypeStats.get(archetype);
      if (!stats || stats.impressions < 10) continue;

      const engagementRate = stats.interactions / stats.impressions;

      if (engagementRate < 0.05) {
        gaps.push({
          intentPattern: archetype,
          severity: 'high',
          description: `Low engagement (${(engagementRate * 100).toFixed(1)}%) for ${archetype} intent — content may not match user expectations`,
        });
      } else if (engagementRate < 0.1) {
        gaps.push({
          intentPattern: archetype,
          severity: 'medium',
          description: `Below-average engagement (${(engagementRate * 100).toFixed(1)}%) for ${archetype} intent`,
        });
      }
    }

    // Check for archetypes with no content atoms
    const atomPurposes = new Set(atoms.map((a) => a.metadata.purpose));
    const purposeToArchetype: Record<string, IntentArchetype> = {
      inform: 'explore',
      compare: 'compare',
      persuade: 'dive_deep',
      'enable-action': 'seek_action',
    };

    for (const [purpose, archetype] of Object.entries(purposeToArchetype)) {
      if (!atomPurposes.has(purpose as any)) {
        gaps.push({
          intentPattern: archetype,
          severity: 'medium',
          description: `No content atoms with purpose '${purpose}' — ${archetype} intent may be underserved`,
        });
      }
    }

    return gaps;
  }

  /**
   * Find block templates with consistently poor engagement.
   */
  findTemplateGaps(
    templates: BlockTemplate[],
    events: AnalyticsEvent[],
  ): TemplateGap[] {
    const gaps: TemplateGap[] = [];

    // Group stats by template
    const templateStats = new Map<string, { impressions: number; interactions: number }>();

    for (const event of events) {
      if (!event.isGenerative) continue;

      const stats = templateStats.get(event.blockId) ?? { impressions: 0, interactions: 0 };
      if (event.type === 'impression') stats.impressions++;
      if (event.type === 'interaction') stats.interactions++;
      templateStats.set(event.blockId, stats);
    }

    for (const template of templates) {
      const stats = templateStats.get(template.id);
      if (!stats || stats.impressions < 5) continue;

      const engagementRate = stats.interactions / stats.impressions;

      if (engagementRate < 0.03) {
        gaps.push({
          position: template.position,
          templateId: template.id,
          engagementRate,
          description: `Template '${template.id}' at ${template.position} has very low engagement (${(engagementRate * 100).toFixed(1)}%)`,
        });
      }
    }

    // Check for positions without templates
    const coveredPositions = new Set(templates.map((t) => t.position));
    const allPositions: BlockPosition[] = ['hero', 'above-fold', 'mid-page', 'below-fold', 'footer'];

    for (const position of allPositions) {
      if (!coveredPositions.has(position)) {
        gaps.push({
          position,
          engagementRate: 0,
          description: `No block templates available for ${position} position`,
        });
      }
    }

    return gaps;
  }

  /**
   * Find audience segments underserved by available content.
   */
  findAudienceGaps(atoms: ContentAtom[]): AudienceGap[] {
    const gaps: AudienceGap[] = [];

    const depthCounts: Record<string, number> = { novice: 0, intermediate: 0, expert: 0 };
    for (const atom of atoms) {
      depthCounts[atom.metadata.audienceDepth] =
        (depthCounts[atom.metadata.audienceDepth] ?? 0) + 1;
    }

    const total = atoms.length;
    if (total === 0) return gaps;

    for (const [depth, count] of Object.entries(depthCounts)) {
      const ratio = count / total;
      if (ratio < 0.1 && total >= 10) {
        gaps.push({
          audienceMode: depth,
          contentDepth: depth,
          availableAtoms: count,
          description: `Only ${count} atoms (${(ratio * 100).toFixed(0)}%) for '${depth}' audience — may need more content at this level`,
        });
      }
    }

    return gaps;
  }
}

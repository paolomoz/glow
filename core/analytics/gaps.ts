import type { IntentArchetype, BlockPosition } from '../types.js';

export interface ContentGap {
  intentPattern: IntentArchetype;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface TemplateGap {
  position: BlockPosition;
  engagementRate: number;
  description: string;
}

/**
 * Identifies intent patterns with poor content matches
 * and block templates with consistently poor engagement.
 */
export interface GapAnalyzer {
  findContentGaps(siteId: string): Promise<ContentGap[]>;
  findTemplateGaps(siteId: string): Promise<TemplateGap[]>;
}

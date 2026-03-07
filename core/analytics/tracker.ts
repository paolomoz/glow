import type { AnalyticsEvent } from '../types.js';

/**
 * Collects engagement events for generative and original blocks.
 */
export interface EngagementTracker {
  trackImpression(event: Omit<AnalyticsEvent, 'type'>): void;
  trackInteraction(event: Omit<AnalyticsEvent, 'type'>): void;
  trackDwell(event: Omit<AnalyticsEvent, 'type'>): void;
  trackConversion(event: Omit<AnalyticsEvent, 'type'>): void;
  flush(): Promise<void>;
}

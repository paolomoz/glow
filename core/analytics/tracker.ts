// core/analytics/tracker.ts — Engagement event collection
// CC-6.1: Track impressions, dwell time, interactions, downstream actions

import type { AnalyticsEvent, StorageInterface } from '../types.js';

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

/**
 * Default engagement tracker that buffers events and flushes to storage.
 * Compares same metrics for original blocks (isGenerative=false) to enable A/B analysis.
 */
export class DefaultEngagementTracker implements EngagementTracker {
  private buffer: AnalyticsEvent[] = [];
  private flushSize: number;
  private storage: StorageInterface;

  constructor(storage: StorageInterface, options?: { flushSize?: number }) {
    this.storage = storage;
    this.flushSize = options?.flushSize ?? 20;
  }

  trackImpression(event: Omit<AnalyticsEvent, 'type'>): void {
    this.addEvent({ ...event, type: 'impression' });
  }

  trackInteraction(event: Omit<AnalyticsEvent, 'type'>): void {
    this.addEvent({ ...event, type: 'interaction' });
  }

  trackDwell(event: Omit<AnalyticsEvent, 'type'>): void {
    this.addEvent({ ...event, type: 'dwell' });
  }

  trackConversion(event: Omit<AnalyticsEvent, 'type'>): void {
    this.addEvent({ ...event, type: 'conversion' });
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);
    await Promise.all(events.map((e) => this.storage.logEvent(e)));
  }

  private addEvent(event: AnalyticsEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.flushSize) {
      this.flush().catch(() => {});
    }
  }

  /** Get current buffer size (for testing). */
  get pendingCount(): number {
    return this.buffer.length;
  }
}

// extension/background/session.ts — Session intent state management
// CC-3.1.3: Stores per-tab session state with intent tracking

import type { IntentVector, Signal } from '@glow/core';
import { SESSION_TIMEOUT_MS } from '@glow/core';

export interface SessionState {
  sessionId: string;
  siteId: string;
  tabId: number;
  intent: IntentVector | null;
  signalCount: number;
  lastActivity: number;
  generatedBlocks: number;
}

/**
 * Manages per-tab browsing sessions.
 * Each tab gets its own session, expired after 30 min of inactivity.
 */
export class SessionManager {
  private sessions = new Map<number, SessionState>();
  private counter = 0;

  /** Get or create a session for a tab. */
  getSession(tabId: number, siteId: string): SessionState {
    const existing = this.sessions.get(tabId);
    if (existing && existing.siteId === siteId && !this.isExpired(existing)) {
      return existing;
    }

    const session: SessionState = {
      sessionId: `ext-${tabId}-${Date.now()}-${++this.counter}`,
      siteId,
      tabId,
      intent: null,
      signalCount: 0,
      lastActivity: Date.now(),
      generatedBlocks: 0,
    };
    this.sessions.set(tabId, session);
    return session;
  }

  /** Update session after signal processing. */
  updateIntent(tabId: number, intent: IntentVector): void {
    const session = this.sessions.get(tabId);
    if (session) {
      session.intent = intent;
      session.lastActivity = Date.now();
      session.signalCount = intent.signalCount;
    }
  }

  /** Record that a block was generated for this session. */
  recordGeneration(tabId: number): void {
    const session = this.sessions.get(tabId);
    if (session) {
      session.generatedBlocks++;
      session.lastActivity = Date.now();
    }
  }

  /** Remove session for a closed tab. */
  removeSession(tabId: number): void {
    this.sessions.delete(tabId);
  }

  /** Clean up expired sessions. */
  cleanExpired(): void {
    for (const [tabId, session] of this.sessions) {
      if (this.isExpired(session)) {
        this.sessions.delete(tabId);
      }
    }
  }

  private isExpired(session: SessionState): boolean {
    return Date.now() - session.lastActivity > SESSION_TIMEOUT_MS;
  }
}

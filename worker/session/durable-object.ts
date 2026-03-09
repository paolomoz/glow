// worker/session/durable-object.ts — Durable Object for per-user session state
// CC-4.1.2: Intent state, signal history, automatic expiry

import type {
  Signal,
  IntentVector,
  BlockReplacement,
  PipelineResult,
} from '@glow/core';
import {
  DefaultIntentEngine,
  SESSION_TIMEOUT_MS,
} from '@glow/core';
import type { Env } from '../env.js';

interface SessionData {
  intent: IntentVector | null;
  lastActivity: number;
  signalCount: number;
  pageHistory: string[];
}

/**
 * Durable Object: One per user session.
 * Stores intent state, handles signal ingestion and block generation.
 */
export class UserSession {
  private state: DurableObjectState;
  private env: Env;
  private intentEngine: DefaultIntentEngine;
  private sessionData: SessionData | null = null;
  private alarmScheduled: boolean = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.intentEngine = new DefaultIntentEngine();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/ingest':
        return this.handleIngest(request);
      case '/intent':
        return this.handleGetIntent();
      case '/blocks':
        return this.handleGetBlocks(request);
      case '/expire':
        return this.handleExpire();
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  // -------------------------------------------------------------------------
  // Signal ingestion
  // -------------------------------------------------------------------------

  private async handleIngest(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      signals: Signal[];
      sessionId: string;
    };

    const data = await this.getSessionData();
    const currentIntent = data.intent;

    const newIntent = this.intentEngine.ingestSignals(
      currentIntent,
      body.signals,
    );

    data.intent = newIntent;
    data.lastActivity = Date.now();
    data.signalCount += body.signals.length;

    // Track page visits
    for (const signal of body.signals) {
      if (
        signal.type === 'page_visit' &&
        typeof signal.data.url === 'string'
      ) {
        if (!data.pageHistory.includes(signal.data.url)) {
          data.pageHistory.push(signal.data.url);
          if (data.pageHistory.length > 50) {
            data.pageHistory.shift();
          }
        }
      }
    }

    await this.saveSessionData(data);
    await this.scheduleExpiry();

    return Response.json({
      intent: newIntent,
      signalCount: data.signalCount,
    });
  }

  // -------------------------------------------------------------------------
  // Intent retrieval
  // -------------------------------------------------------------------------

  private async handleGetIntent(): Promise<Response> {
    const data = await this.getSessionData();
    return Response.json({ intent: data.intent });
  }

  // -------------------------------------------------------------------------
  // Block generation request
  // -------------------------------------------------------------------------

  private async handleGetBlocks(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pageUrl = url.searchParams.get('pageUrl');

    if (!pageUrl) {
      return Response.json({ error: 'pageUrl required' }, { status: 400 });
    }

    const data = await this.getSessionData();
    if (!data.intent) {
      return Response.json({ blocks: [], intent: null });
    }

    data.lastActivity = Date.now();
    await this.saveSessionData(data);

    return Response.json({
      intent: data.intent,
      pageHistory: data.pageHistory,
      signalCount: data.signalCount,
    });
  }

  // -------------------------------------------------------------------------
  // Expiry
  // -------------------------------------------------------------------------

  private async handleExpire(): Promise<Response> {
    await this.state.storage.deleteAll();
    this.sessionData = null;
    return new Response('expired');
  }

  async alarm(): Promise<void> {
    const data = await this.getSessionData();
    if (Date.now() - data.lastActivity > SESSION_TIMEOUT_MS) {
      await this.state.storage.deleteAll();
      this.sessionData = null;
    }
  }

  private async scheduleExpiry(): Promise<void> {
    if (!this.alarmScheduled) {
      await this.state.storage.setAlarm(
        Date.now() + SESSION_TIMEOUT_MS + 1000,
      );
      this.alarmScheduled = true;
    }
  }

  // -------------------------------------------------------------------------
  // Storage helpers
  // -------------------------------------------------------------------------

  private async getSessionData(): Promise<SessionData> {
    if (this.sessionData) return this.sessionData;

    const stored = await this.state.storage.get<SessionData>('session');
    this.sessionData = stored ?? {
      intent: null,
      lastActivity: Date.now(),
      signalCount: 0,
      pageHistory: [],
    };
    return this.sessionData;
  }

  private async saveSessionData(data: SessionData): Promise<void> {
    this.sessionData = data;
    await this.state.storage.put('session', data);
  }
}

// CF Workers Durable Object types
interface DurableObjectState {
  storage: DurableObjectStorage;
  id: { toString(): string };
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
}

// extension/background/messages.ts — Message types for extension communication

import type {
  Signal,
  IntentVector,
  BlockReplacement,
  ContentIndex,
} from '@glow/core';

// ---------------------------------------------------------------------------
// Content Script → Background messages
// ---------------------------------------------------------------------------

export interface SignalBatchMessage {
  type: 'SIGNAL_BATCH';
  signals: Signal[];
  pageUrl: string;
  tabId?: number;
}

export interface IndexSiteMessage {
  type: 'INDEX_SITE';
  url: string;
}

export interface GetStatusMessage {
  type: 'GET_STATUS';
}

// ---------------------------------------------------------------------------
// Background → Content Script messages
// ---------------------------------------------------------------------------

export interface InjectBlocksMessage {
  type: 'INJECT_BLOCKS';
  blocks: BlockReplacement[];
}

export interface IndexProgressMessage {
  type: 'INDEX_PROGRESS';
  stage: 'crawling' | 'extracting' | 'embedding' | 'profiling' | 'complete' | 'error';
  progress: number; // 0-1
  message: string;
}

// ---------------------------------------------------------------------------
// Panel ↔ Background messages
// ---------------------------------------------------------------------------

export interface GetIntentMessage {
  type: 'GET_INTENT';
  sessionId: string;
}

export interface IntentUpdateMessage {
  type: 'INTENT_UPDATE';
  intent: IntentVector;
}

export interface SignalLogMessage {
  type: 'SIGNAL_LOG';
  signal: Signal;
}

export interface BlockGeneratedMessage {
  type: 'BLOCK_GENERATED';
  block: BlockReplacement;
  pageUrl: string;
}

export interface SetApiKeyMessage {
  type: 'SET_API_KEY';
  apiKey: string;
}

export interface GetApiKeyMessage {
  type: 'GET_API_KEY';
}

export interface GetIndexStatusMessage {
  type: 'GET_INDEX_STATUS';
  siteId: string;
}

export interface IndexStatusResponse {
  indexed: boolean;
  atomCount: number;
  templateCount: number;
  siteType: string;
  indexedAt?: string;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type ExtensionMessage =
  | SignalBatchMessage
  | IndexSiteMessage
  | GetStatusMessage
  | InjectBlocksMessage
  | IndexProgressMessage
  | GetIntentMessage
  | IntentUpdateMessage
  | SignalLogMessage
  | BlockGeneratedMessage
  | SetApiKeyMessage
  | GetApiKeyMessage
  | GetIndexStatusMessage;

/** Icon state for the extension action badge. */
export type IconState = 'inactive' | 'indexing' | 'active' | 'generating';

// extension/background/service-worker.ts — Background service worker
// CC-3.1.3: Lifecycle, message routing between content script and panel

import type { Signal, BlockReplacement } from '@glow/core';
import { DefaultIntentEngine } from '@glow/core';
import { DefaultOrchestrator } from '@glow/core';
import { DefaultCerebrasClient } from '@glow/core';
import type {
  ExtensionMessage,
  IconState,
  SignalBatchMessage,
  IndexSiteMessage,
  ImportIndexMessage,
  GenerateMessage,
  GenerationSource,
} from './messages.js';
import { SessionManager } from './session.js';
import { IndexedDBStorageAdapter } from '../storage/indexeddb-adapter.js';

// ---------------------------------------------------------------------------
// Build info — check this in SW console to verify you have the latest build
// ---------------------------------------------------------------------------
console.log(`[glow] Service worker loaded — build: ${__BUILD_TIMESTAMP__}`);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessionManager = new SessionManager();
const intentEngine = new DefaultIntentEngine();
let orchestrator: DefaultOrchestrator | null = null;

// Panel connections for real-time updates
const panelPorts = new Map<number, chrome.runtime.Port>();

// Per-tab lock to prevent concurrent signal processing
const processingTabs = new Set<number>();

// ---------------------------------------------------------------------------
// Icon state management (CC-3.1.6)
// ---------------------------------------------------------------------------

const ICON_COLORS: Record<IconState, string> = {
  inactive: '#9CA3AF',   // gray
  indexing: '#F59E0B',   // amber (pulse)
  active: '#8B5CF6',     // purple
  generating: '#3B82F6', // blue (animated)
};

function setIconState(tabId: number, state: IconState): void {
  const color = ICON_COLORS[state];
  chrome.action.setBadgeBackgroundColor({ color, tabId });

  switch (state) {
    case 'inactive':
      chrome.action.setBadgeText({ text: '', tabId });
      break;
    case 'indexing':
      chrome.action.setBadgeText({ text: '⟳', tabId });
      break;
    case 'active':
      chrome.action.setBadgeText({ text: '✦', tabId });
      break;
    case 'generating':
      chrome.action.setBadgeText({ text: '…', tabId });
      break;
  }
}

// ---------------------------------------------------------------------------
// API key management (CC-3.1.5)
// ---------------------------------------------------------------------------

// Fallback API key from .env — avoids manual entry in panel
const BUILTIN_API_KEY = 'csk-hd95yw8mc843685x2rnfpekdkvkfppyfmvy253y6k5cctcdj';

async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('cerebras_api_key');
  return result.cerebras_api_key ?? BUILTIN_API_KEY;
}

async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ cerebras_api_key: key });
  // Re-initialize orchestrator with new key
  await initOrchestrator();
}

let storageAdapter: IndexedDBStorageAdapter | null = null;

function getStorage(): IndexedDBStorageAdapter {
  if (!storageAdapter) {
    storageAdapter = new IndexedDBStorageAdapter();
  }
  return storageAdapter;
}

async function initOrchestrator(siteId?: string): Promise<DefaultOrchestrator | null> {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const storage = getStorage();
  const cerebrasClient = new DefaultCerebrasClient({
    apiKey,
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultTimeoutMs: 5000,
  });

  // Load brand profile from IndexedDB for the current site
  let brandProfile = siteId ? await storage.getBrandProfile(siteId) : null;
  if (!brandProfile) {
    brandProfile = {
      siteId: siteId ?? '',
      voice: {
        tone: ['professional'],
        formality: 'balanced' as const,
        personPerspective: 'second' as const,
        characteristicPhrases: [],
      },
      visual: {
        primaryColors: [],
        fontFamilies: [],
        spacingScale: [],
      },
      guardrails: {
        forbiddenTerms: [],
        requiredDisclaimers: [],
        approvalRequired: false,
        maxGeneratedBlocksPerPage: 5,
      },
      siteType: 'other' as const,
      skillConfig: 'default',
    };
  }

  orchestrator = new DefaultOrchestrator({
    intentEngine,
    storage,
    cerebrasClient,
    brandProfile,
  });

  return orchestrator;
}

// ---------------------------------------------------------------------------
// Signal processing
// ---------------------------------------------------------------------------

/** Track the last known page URL per tab for use in explicit generation. */
const tabPageUrls = new Map<number, string>();

/** Track the generation source for chatgpt signals per tab. */
const tabHasChatGptSignals = new Map<number, boolean>();

/** Track the generation source for LLMO signals per tab. */
const tabHasLLMOSignals = new Map<number, boolean>();

/** Track accumulated intent per tab (separate from orchestrator). */
const tabIntents = new Map<number, import('@glow/core').IntentVector>();

/**
 * Handle a signal batch: update intent only, do NOT generate blocks.
 * Generation is triggered explicitly via GENERATE message.
 */
async function handleSignalBatch(
  msg: SignalBatchMessage,
  tabId: number,
): Promise<void> {
  const siteId = new URL(msg.pageUrl).hostname;
  sessionManager.getSession(tabId, siteId);
  tabPageUrls.set(tabId, msg.pageUrl);

  // Track if chatgpt signals have been ingested
  const hasChatGpt = msg.signals.some((s) => (s.data as any).source === 'chatgpt');
  if (hasChatGpt) {
    tabHasChatGptSignals.set(tabId, true);
  }

  // Track if LLMO signals have been ingested
  const hasLLMO = msg.signals.some((s) => (s.data as any).source === 'llmo');
  if (hasLLMO) {
    tabHasLLMOSignals.set(tabId, true);
  }

  if (!orchestrator) {
    await initOrchestrator(siteId);
  }

  // Forward signals to panel for live display
  notifyPanel(tabId, {
    type: 'SIGNAL_LOG',
    signal: msg.signals[msg.signals.length - 1],
  });

  // Update intent state only (no generation)
  const currentIntent = tabIntents.get(tabId) ?? null;
  const intent = intentEngine.ingestSignals(currentIntent, msg.signals);
  tabIntents.set(tabId, intent);

  // Sync intent to orchestrator so it's ready when Generate is clicked
  const session = sessionManager.getSession(tabId, siteId);
  orchestrator?.updateIntent(session.sessionId, intent);

  console.log(`[glow] Intent updated: archetype=${intent.archetype}, confidence=${intent.confidence.toFixed(3)}, signals=${intent.signalCount}`);
  sessionManager.updateIntent(tabId, intent);

  notifyPanel(tabId, {
    type: 'INTENT_UPDATE',
    intent,
  });

  setIconState(tabId, 'active');
}

/**
 * Handle explicit generation request from the panel.
 */
async function handleGenerate(
  msg: GenerateMessage,
  tabId: number,
): Promise<BlockReplacement[]> {
  if (processingTabs.has(tabId)) return [];

  const pageUrl = tabPageUrls.get(tabId) ?? '';
  if (!pageUrl) {
    console.warn(`[glow] No page URL known for tab ${tabId}`);
    return [];
  }

  const siteId = new URL(pageUrl).hostname;
  const session = sessionManager.getSession(tabId, siteId);

  if (!orchestrator) {
    await initOrchestrator(siteId);
  }
  if (!orchestrator) {
    console.warn(`[glow] No orchestrator (no API key?)`);
    return [];
  }

  processingTabs.add(tabId);
  setIconState(tabId, 'generating');

  try {
    console.log(`[glow] Generating blocks (source=${msg.source}) for ${siteId}`);

    // Clear generated templates so all positions get fresh blocks
    const session_ = sessionManager.getSession(tabId, siteId);
    orchestrator.clearGeneratedTemplates(session_.sessionId);

    const result = await orchestrator.process(
      siteId,
      session_.sessionId,
      pageUrl,
      [], // empty signals — intent already accumulated
      { explicitGeneration: true },
    );

    console.log(`[glow] Result: archetype=${result.intent.archetype}, confidence=${result.intent.confidence.toFixed(3)}, blocks=${result.blocks.length}, totalTime=${result.totalTimeMs}ms`);

    // Tag blocks with generation source
    for (const block of result.blocks) {
      block.source = msg.source;
      sessionManager.recordGeneration(tabId);
      notifyPanel(tabId, {
        type: 'BLOCK_GENERATED',
        block,
        pageUrl,
        source: msg.source,
      });
    }

    // Send blocks to the content script for injection
    if (result.blocks.length > 0 && tabId > 0) {
      chrome.tabs.sendMessage(tabId, {
        type: 'INJECT_BLOCKS',
        blocks: result.blocks,
      });
    }

    setIconState(tabId, 'active');
    processingTabs.delete(tabId);
    return result.blocks;
  } catch (err) {
    console.error(`[glow] Error generating blocks:`, err);
    setIconState(tabId, 'active');
    processingTabs.delete(tabId);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Clear all state
// ---------------------------------------------------------------------------

async function handleClearAll(tabId: number): Promise<void> {
  console.log(`[glow] Clearing all state for tab ${tabId}`);

  // Tell content script to restore the original page
  if (tabId > 0) {
    chrome.tabs.sendMessage(tabId, { type: 'RESTORE_ALL' });
  }

  // Clear per-tab state
  tabIntents.delete(tabId);
  tabPageUrls.delete(tabId);
  tabHasChatGptSignals.delete(tabId);
  tabHasLLMOSignals.delete(tabId);
  processingTabs.delete(tabId);

  // Clear session
  sessionManager.removeSession(tabId);

  // Reset orchestrator caches
  orchestrator = null;

  setIconState(tabId, 'inactive');
}

// ---------------------------------------------------------------------------
// Panel communication
// ---------------------------------------------------------------------------

function notifyPanel(tabId: number, message: ExtensionMessage): void {
  const port = panelPorts.get(tabId);
  if (port) {
    try {
      port.postMessage(message);
    } catch {
      panelPorts.delete(tabId);
    }
  }
}

// ---------------------------------------------------------------------------
// Index import
// ---------------------------------------------------------------------------

async function handleImportIndex(
  msg: ImportIndexMessage,
): Promise<{ success: boolean; atomCount: number; templateCount: number; error?: string }> {
  try {
    const storage = getStorage();
    const { index } = msg;

    // Clear existing data before importing new index
    console.log(`[glow] Clearing existing index data...`);
    await storage.clear();
    console.log(`[glow] Cleared. Importing ${index.atoms.length} atoms, ${index.templates.length} templates`);

    // Store atoms, templates, and brand profile
    await storage.storeAtoms(index.atoms);
    await storage.storeTemplates(index.templates);
    await storage.storeBrandProfile(index.brandProfile);

    // Re-initialize orchestrator with new brand profile and clear caches
    orchestrator = null;
    sessionManager.clearAll();
    await initOrchestrator(index.siteId);

    return {
      success: true,
      atomCount: index.atoms.length,
      templateCount: index.templates.length,
    };
  } catch (err) {
    return {
      success: false,
      atomCount: 0,
      templateCount: 0,
      error: String(err),
    };
  }
}

async function handleGetIndexStatus(
  siteId: string,
): Promise<{ indexed: boolean; atomCount: number; templateCount: number }> {
  try {
    const storage = getStorage();
    const stats = await storage.getIndexStats(siteId);
    return {
      indexed: stats.atomCount > 0,
      ...stats,
    };
  } catch {
    return { indexed: false, atomCount: 0, templateCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    const tabId = sender.tab?.id ?? 0;

    switch (message.type) {
      case 'SIGNAL_BATCH': {
        const effectiveTabId = message.tabId ?? tabId;
        handleSignalBatch(message, effectiveTabId).then(() => {
          sendResponse({ ok: true });
        });
        return true; // Async response
      }

      case 'GENERATE': {
        const genTabId = message.tabId ?? tabId;
        handleGenerate(message, genTabId).then((blocks) => {
          sendResponse({ blocks });
        });
        return true;
      }

      case 'CLEAR_ALL': {
        const clearTabId = message.tabId ?? tabId;
        handleClearAll(clearTabId).then(() => {
          sendResponse({ ok: true });
        });
        return true;
      }

      case 'SET_API_KEY':
        setApiKey(message.apiKey).then(() => {
          sendResponse({ success: true });
        });
        return true;

      case 'GET_API_KEY':
        getApiKey().then((apiKey) => {
          sendResponse({ apiKey });
        });
        return true;

      case 'GET_STATUS': {
        const session = tabId
          ? sessionManager.getSession(tabId, '')
          : null;
        sendResponse({
          hasApiKey: orchestrator !== null,
          session: session
            ? {
                signalCount: session.signalCount,
                generatedBlocks: session.generatedBlocks,
                intent: session.intent,
              }
            : null,
        });
        return false;
      }

      case 'GET_INTENT': {
        const sess = sessionManager.getSession(tabId, '');
        sendResponse({ intent: sess?.intent ?? null });
        return false;
      }

      case 'IMPORT_INDEX':
        handleImportIndex(message).then((result) => {
          sendResponse(result);
        });
        return true;

      case 'GET_INDEX_STATUS':
        handleGetIndexStatus(message.siteId).then((result) => {
          sendResponse(result);
        });
        return true;

      default:
        return false;
    }
  },
);

// Panel connection via long-lived port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('glow-panel-')) {
    const tabId = parseInt(port.name.replace('glow-panel-', ''), 10);
    panelPorts.set(tabId, port);

    port.onDisconnect.addListener(() => {
      panelPorts.delete(tabId);
    });
  }
});

// Clean up sessions when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  sessionManager.removeSession(tabId);
  panelPorts.delete(tabId);
  setIconState(tabId, 'inactive');
});

// Open side panel on action click
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Periodic cleanup
setInterval(() => {
  sessionManager.cleanExpired();
}, 60_000);

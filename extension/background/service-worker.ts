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
} from './messages.js';
import { SessionManager } from './session.js';
import { IndexedDBStorageAdapter } from '../storage/indexeddb-adapter.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessionManager = new SessionManager();
const intentEngine = new DefaultIntentEngine();
let orchestrator: DefaultOrchestrator | null = null;

// Panel connections for real-time updates
const panelPorts = new Map<number, chrome.runtime.Port>();

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

async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('cerebras_api_key');
  return result.cerebras_api_key ?? null;
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

async function handleSignalBatch(
  msg: SignalBatchMessage,
  tabId: number,
): Promise<BlockReplacement[]> {
  const siteId = new URL(msg.pageUrl).hostname;
  const session = sessionManager.getSession(tabId, siteId);

  if (!orchestrator) {
    await initOrchestrator(siteId);
  }

  if (!orchestrator) {
    return []; // No API key configured
  }

  setIconState(tabId, 'generating');

  // Forward signals to panel for live display
  notifyPanel(tabId, {
    type: 'SIGNAL_LOG',
    signal: msg.signals[msg.signals.length - 1],
  });

  try {
    const result = await orchestrator.process(
      siteId,
      session.sessionId,
      msg.pageUrl,
      msg.signals,
    );

    sessionManager.updateIntent(tabId, result.intent);

    // Notify panel of intent update
    notifyPanel(tabId, {
      type: 'INTENT_UPDATE',
      intent: result.intent,
    });

    // Notify panel of generated blocks
    for (const block of result.blocks) {
      sessionManager.recordGeneration(tabId);
      notifyPanel(tabId, {
        type: 'BLOCK_GENERATED',
        block,
        pageUrl: msg.pageUrl,
      });
    }

    setIconState(tabId, result.blocks.length > 0 ? 'active' : 'active');
    return result.blocks;
  } catch {
    setIconState(tabId, 'active');
    return [];
  }
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

    // Store atoms, templates, and brand profile
    await storage.storeAtoms(index.atoms);
    await storage.storeTemplates(index.templates);
    await storage.storeBrandProfile(index.brandProfile);

    // Re-initialize orchestrator with new brand profile
    orchestrator = null;
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
      case 'SIGNAL_BATCH':
        handleSignalBatch(message, tabId).then((blocks) => {
          sendResponse({ type: 'INJECT_BLOCKS', blocks });
        });
        return true; // Async response

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

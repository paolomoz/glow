// extension/panel/panel.ts — Debug panel entry point
// Connects to background service worker and renders debug UI

import type { IntentVector, BlockReplacement } from '@glow/core';
import type { ExtensionMessage } from '../background/messages.js';
import { renderIntentMeter } from './components/intent-meter.js';
import { appendSignalEntry } from './components/signal-log.js';
import { renderBlockList, type BlockEntry } from './components/block-map.js';
import { renderTimingBreakdown } from './components/timing-breakdown.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentIntent: IntentVector | null = null;
const generatedBlocks: BlockEntry[] = [];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const statusBadge = document.getElementById('status-badge')!;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const saveKeyBtn = document.getElementById('save-key-btn')!;
const intentContent = document.getElementById('intent-content')!;
const signalLog = document.getElementById('signal-log')!;
const blockList = document.getElementById('block-list')!;
const timingContent = document.getElementById('timing-content')!;
const importBtn = document.getElementById('import-btn')!;
const importFile = document.getElementById('import-file') as HTMLInputElement;
const importStatus = document.getElementById('import-status')!;
const indexContent = document.getElementById('index-content')!;

// ---------------------------------------------------------------------------
// API Key management
// ---------------------------------------------------------------------------

// Load existing key
chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (response) => {
  if (response?.apiKey) {
    apiKeyInput.value = '••••••••';
    apiKeyInput.placeholder = 'Key saved';
    updateStatus('active');
  }
});

saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key || key === '••••••••') return;

  chrome.runtime.sendMessage(
    { type: 'SET_API_KEY', apiKey: key },
    (response) => {
      if (response?.success) {
        apiKeyInput.value = '••••••••';
        updateStatus('active');
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Background connection
// ---------------------------------------------------------------------------

// Get current tab ID for port name
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabId = tabs[0]?.id;
  if (!tabId) return;

  const port = chrome.runtime.connect({ name: `glow-panel-${tabId}` });

  port.onMessage.addListener((message: ExtensionMessage) => {
    switch (message.type) {
      case 'INTENT_UPDATE':
        currentIntent = message.intent;
        renderIntentMeter(intentContent, message.intent);
        updateStatus('active');
        break;

      case 'SIGNAL_LOG':
        appendSignalEntry(signalLog, message.signal);
        break;

      case 'BLOCK_GENERATED':
        generatedBlocks.push({
          block: message.block,
          pageUrl: message.pageUrl,
          timestamp: Date.now(),
        });
        renderBlockList(blockList, generatedBlocks);
        if (currentIntent) {
          renderTimingBreakdown(
            timingContent,
            generatedBlocks.map((b) => b.block),
            generatedBlocks.reduce(
              (sum, b) => sum + b.block.generationTimeMs,
              0,
            ),
          );
        }
        updateStatus('generating');
        setTimeout(() => updateStatus('active'), 1000);
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    updateStatus('inactive');
  });

  // Request initial state
  chrome.runtime.sendMessage(
    { type: 'GET_STATUS' },
    (response) => {
      if (response?.session?.intent) {
        currentIntent = response.session.intent;
        renderIntentMeter(intentContent, response.session.intent);
        updateStatus('active');
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Index import
// ---------------------------------------------------------------------------

importBtn.addEventListener('click', () => {
  importFile.click();
});

importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;

  importStatus.textContent = 'Reading...';
  importBtn.setAttribute('disabled', 'true');

  try {
    const text = await file.text();
    const index = JSON.parse(text);

    if (!index.atoms || !index.templates || !index.brandProfile) {
      importStatus.textContent = 'Invalid index file';
      importBtn.removeAttribute('disabled');
      return;
    }

    importStatus.textContent = `Importing ${index.atoms.length} atoms...`;

    chrome.runtime.sendMessage(
      { type: 'IMPORT_INDEX', index },
      (response) => {
        importBtn.removeAttribute('disabled');
        if (response?.success) {
          importStatus.textContent = `${response.atomCount} atoms, ${response.templateCount} templates`;
          indexContent.innerHTML = `
            <div style="font-size: 12px;">
              <div><strong>${response.atomCount}</strong> atoms</div>
              <div><strong>${response.templateCount}</strong> templates</div>
              <div style="color: var(--glow-green);">Indexed</div>
            </div>
          `;
        } else {
          importStatus.textContent = `Error: ${response?.error ?? 'unknown'}`;
        }
      },
    );
  } catch (err) {
    importStatus.textContent = `Parse error: ${err}`;
    importBtn.removeAttribute('disabled');
  }

  // Reset file input
  importFile.value = '';
});

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

function updateStatus(state: 'inactive' | 'active' | 'generating'): void {
  statusBadge.textContent =
    state === 'inactive'
      ? 'Inactive'
      : state === 'generating'
        ? 'Generating...'
        : 'Active';

  statusBadge.style.background =
    state === 'inactive'
      ? 'rgba(107, 114, 128, 0.2)'
      : state === 'generating'
        ? 'rgba(59, 130, 246, 0.2)'
        : 'rgba(139, 92, 246, 0.2)';

  statusBadge.style.color =
    state === 'inactive'
      ? '#6b7280'
      : state === 'generating'
        ? '#3b82f6'
        : '#8b5cf6';
}

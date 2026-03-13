// extension/panel/panel.ts — Debug panel entry point
// Connects to background service worker and renders debug UI

import type { IntentVector, BlockReplacement } from '@glow/core';
import type { ExtensionMessage, GenerationSource } from '../background/messages.js';
import { renderIntentMeter } from './components/intent-meter.js';
import { appendSignalEntry } from './components/signal-log.js';
import { renderBlockList, type BlockEntry } from './components/block-map.js';
import { renderTimingBreakdown } from './components/timing-breakdown.js';
import type { LLMOPrompt } from '../../llmo/prompt-index.js';
import { buildPromptIndex, lookupPromptsByUrl, llmoIntentToArchetype } from '../../llmo/prompt-index.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentIntent: IntentVector | null = null;
let signalCount = 0;
let chatgptReady = false;
let chatgptSignalCount = 0;
let llmoReady = false;
let llmoSignalCount = 0;
let llmoPrompts: LLMOPrompt[] = [];
let llmoIndex: ReturnType<typeof buildPromptIndex> | null = null;
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
const generateSignalsBtn = document.getElementById('generate-signals-btn') as HTMLButtonElement;
const generateChatgptBtn = document.getElementById('generate-chatgpt-btn') as HTMLButtonElement;
const signalCountLabel = document.getElementById('signal-count-label')!;
const chatgptCountLabel = document.getElementById('chatgpt-count-label')!;
const generateStatus = document.getElementById('generate-status')!;
const generateLlmoBtn = document.getElementById('generate-llmo-btn') as HTMLButtonElement;
const llmoCountLabel = document.getElementById('llmo-count-label')!;
const llmoPromptSelect = document.getElementById('llmo-prompt-select') as HTMLSelectElement;
const clearBtn = document.getElementById('clear-btn')!;

// ---------------------------------------------------------------------------
// API Key management
// ---------------------------------------------------------------------------

// Load existing key
chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (response) => {
  if (response?.apiKey) {
    apiKeyInput.value = '••••••••';
    apiKeyInput.placeholder = 'Key saved';
    updateStatus('active');
  } else {
    // Built-in key is available — show as pre-configured
    apiKeyInput.value = '••••••••';
    apiKeyInput.placeholder = 'Built-in key active';
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
        signalCount = message.intent.signalCount;
        renderIntentMeter(intentContent, message.intent);
        updateGenerateButtons();
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
          source: message.source,
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

  // Check index status for current site
  const currentTab = tabs[0];
  if (currentTab?.url) {
    try {
      const siteId = new URL(currentTab.url).hostname;
      chrome.runtime.sendMessage(
        { type: 'GET_INDEX_STATUS', siteId },
        (response) => {
          if (response?.indexed) {
            indexContent.innerHTML = `
              <div style="font-size: 12px;">
                <div><strong>${response.atomCount}</strong> atoms</div>
                <div><strong>${response.templateCount}</strong> templates</div>
                <div style="color: var(--glow-green);">Indexed</div>
              </div>
            `;
          }
        },
      );
    } catch { /* not a valid URL */ }
  }
});

// ---------------------------------------------------------------------------
// ChatGPT import
// ---------------------------------------------------------------------------

const chatgptBtn = document.getElementById('chatgpt-btn')!;
const chatgptFile = document.getElementById('chatgpt-file') as HTMLInputElement;
const chatgptStatus = document.getElementById('chatgpt-status')!;

chatgptBtn.addEventListener('click', () => {
  chatgptFile.click();
});

chatgptFile.addEventListener('change', async () => {
  const file = chatgptFile.files?.[0];
  if (!file) return;

  chatgptStatus.textContent = 'Reading...';
  chatgptBtn.setAttribute('disabled', 'true');

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    const { parseExport } = await import('../../core/conversation/parser.js');

    // Determine current page URL for signal association
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tabs[0]?.url ?? 'https://unknown/';

    const conversations = Array.isArray(data) ? data : data.conversations ?? [data];
    const signals = parseExport(conversations, pageUrl, { maxConversations: 5 });

    if (signals.length === 0) {
      chatgptStatus.textContent = 'No signals extracted';
      chatgptBtn.removeAttribute('disabled');
      return;
    }

    chatgptStatus.textContent = `Sending ${signals.length} signals...`;

    // Send chatgpt signals to update intent (no auto-generation)
    const targetTabId = tabs[0]?.id ?? 0;
    chrome.runtime.sendMessage(
      { type: 'SIGNAL_BATCH', signals, pageUrl, tabId: targetTabId },
      (response) => {
        chatgptBtn.removeAttribute('disabled');
        if (chrome.runtime.lastError) {
          chatgptStatus.textContent = `Error: ${chrome.runtime.lastError.message}`;
        } else {
          chatgptSignalCount = signals.length;
          chatgptReady = true;
          chatgptStatus.textContent = `${signals.length} signals ingested — click Generate`;
          updateGenerateButtons();
        }
      },
    );
  } catch (err) {
    chatgptStatus.textContent = `Parse error: ${err}`;
    chatgptBtn.removeAttribute('disabled');
  }

  chatgptFile.value = '';
});

// ---------------------------------------------------------------------------
// LLMO import
// ---------------------------------------------------------------------------

const llmoImportBtn = document.getElementById('llmo-import-btn')!;
const llmoFile = document.getElementById('llmo-file') as HTMLInputElement;
const llmoStatus = document.getElementById('llmo-status')!;

llmoImportBtn.addEventListener('click', () => {
  llmoFile.click();
});

llmoFile.addEventListener('change', async () => {
  const file = llmoFile.files?.[0];
  if (!file) return;

  llmoStatus.textContent = 'Reading...';
  llmoImportBtn.setAttribute('disabled', 'true');

  try {
    const text = await file.text();
    const data: LLMOPrompt[] = JSON.parse(text);

    if (!Array.isArray(data) || data.length === 0) {
      llmoStatus.textContent = 'Invalid prompts file (expected JSON array)';
      llmoImportBtn.removeAttribute('disabled');
      return;
    }

    llmoPrompts = data;
    llmoIndex = buildPromptIndex(data);

    // Populate dropdown filtered by current page URL
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tabs[0]?.url ?? '';
    populateLlmoDropdown(pageUrl);

    llmoStatus.textContent = `${data.length} prompts loaded`;
    llmoImportBtn.removeAttribute('disabled');
  } catch (err) {
    llmoStatus.textContent = `Parse error: ${err}`;
    llmoImportBtn.removeAttribute('disabled');
  }

  llmoFile.value = '';
});

function populateLlmoDropdown(pageUrl: string): void {
  if (!llmoIndex) return;

  // Get prompts for this URL, or show all if no match
  let matchedPrompts = lookupPromptsByUrl(llmoIndex, pageUrl);
  if (matchedPrompts.length === 0) {
    matchedPrompts = llmoIndex.all;
  }

  // Clear existing options
  llmoPromptSelect.innerHTML = '<option value="">Select an LLMO prompt...</option>';

  for (let i = 0; i < matchedPrompts.length; i++) {
    const p = matchedPrompts[i];
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `[${p.intent}] ${p.prompt.slice(0, 80)}`;
    opt.dataset.prompt = JSON.stringify(p);
    llmoPromptSelect.appendChild(opt);
  }

  llmoPromptSelect.style.display = 'block';
}

llmoPromptSelect.addEventListener('change', async () => {
  const selectedOption = llmoPromptSelect.selectedOptions[0];
  if (!selectedOption?.dataset.prompt) return;

  const prompt: LLMOPrompt = JSON.parse(selectedOption.dataset.prompt);

  // Construct synthetic signals from the LLMO prompt
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tabs[0]?.url ?? prompt.url;
  const tabId = tabs[0]?.id ?? 0;
  const now = new Date().toISOString();

  const signals = [
    {
      type: 'page_visit' as const,
      timestamp: now,
      data: {
        url: pageUrl,
        referrer: 'https://chatgpt.com',
        title: document.title,
        source: 'llmo',
      },
      pageUrl,
    },
    {
      type: 'search_query' as const,
      timestamp: now,
      data: {
        query: prompt.prompt,
        source: 'llmo',
        llmoIntent: prompt.intent,
        llmoTopic: prompt.topic,
        llmoCategory: prompt.category,
      },
      pageUrl,
    },
  ];

  llmoStatus.textContent = `Sending signals for: "${prompt.prompt.slice(0, 40)}..."`;

  chrome.runtime.sendMessage(
    { type: 'SIGNAL_BATCH', signals, pageUrl, tabId },
    (response) => {
      if (chrome.runtime.lastError) {
        llmoStatus.textContent = `Error: ${chrome.runtime.lastError.message}`;
      } else {
        llmoSignalCount = signals.length;
        llmoReady = true;
        llmoStatus.textContent = `Prompt ingested — click "From LLMO" to generate`;
        updateGenerateButtons();
      }
    },
  );
});

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

// ---------------------------------------------------------------------------
// Generate buttons
// ---------------------------------------------------------------------------

function updateGenerateButtons(): void {
  // Signals button: enabled when we have enough signals for intent
  const hasIntent = currentIntent && currentIntent.confidence > 0;
  generateSignalsBtn.disabled = !hasIntent;
  signalCountLabel.textContent = hasIntent
    ? `${signalCount} signals · ${currentIntent!.archetype}`
    : 'No signals yet';

  // ChatGPT button: enabled after conversation import
  generateChatgptBtn.disabled = !chatgptReady;
  chatgptCountLabel.textContent = chatgptReady
    ? `${chatgptSignalCount} signals ingested`
    : 'Import a conversation first';

  // LLMO button: enabled after prompt selection
  generateLlmoBtn.disabled = !llmoReady;
  llmoCountLabel.textContent = llmoReady
    ? `${llmoSignalCount} signals from LLMO prompt`
    : 'Import prompts first';
}

function triggerGenerate(source: GenerationSource): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;

    generateStatus.textContent = `Generating from ${source}...`;
    generateSignalsBtn.disabled = true;
    generateChatgptBtn.disabled = true;
    updateStatus('generating');

    chrome.runtime.sendMessage(
      { type: 'GENERATE', source, tabId },
      (response) => {
        const blockCount = response?.blocks?.length ?? 0;
        generateStatus.textContent = blockCount > 0
          ? `${blockCount} block${blockCount > 1 ? 's' : ''} generated from ${source}`
          : `No blocks generated (confidence too low or no templates)`;
        updateGenerateButtons();
        updateStatus('active');
      },
    );
  });
}

generateSignalsBtn.addEventListener('click', () => triggerGenerate('signals'));
generateChatgptBtn.addEventListener('click', () => triggerGenerate('chatgpt'));
generateLlmoBtn.addEventListener('click', () => triggerGenerate('llmo'));

// ---------------------------------------------------------------------------
// Clear all
// ---------------------------------------------------------------------------

clearBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;

    chrome.runtime.sendMessage({ type: 'CLEAR_ALL', tabId }, () => {
      // Reset local panel state
      currentIntent = null;
      signalCount = 0;
      chatgptReady = false;
      chatgptSignalCount = 0;
      llmoReady = false;
      llmoSignalCount = 0;
      generatedBlocks.length = 0;

      // Reset UI
      intentContent.innerHTML = '<div class="empty-state">Waiting for signals...</div>';
      signalLog.innerHTML = '<div class="empty-state">No signals yet</div>';
      blockList.innerHTML = '<div class="empty-state">No blocks generated</div>';
      timingContent.innerHTML = '<div class="empty-state">No timing data</div>';
      generateStatus.textContent = '';
      chatgptStatus.textContent = '';
      llmoStatus.textContent = '';
      llmoPromptSelect.style.display = 'none';
      updateGenerateButtons();
      updateStatus('inactive');
    });
  });
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

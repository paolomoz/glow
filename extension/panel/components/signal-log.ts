// extension/panel/components/signal-log.ts — Real-time signal stream
// CC-3.3.3: Scrolling list of recent signals with type icons

import type { Signal } from '@glow/core';

const SIGNAL_ICONS: Record<string, string> = {
  page_visit: '🔗',
  scroll_depth: '📜',
  click_target: '👆',
  hover_dwell: '🔍',
  search_query: '🔎',
  filter_select: '⚙',
  navigation: '➡',
  time_on_section: '⏱',
  form_interaction: '📝',
  viewport_block_visibility: '👁',
};

const MAX_LOG_ENTRIES = 50;

/** Append a signal entry to the log container. */
export function appendSignalEntry(
  container: HTMLElement,
  signal: Signal,
): void {
  // Remove empty state if present
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const entry = document.createElement('div');
  entry.className = 'signal-entry';

  const icon = SIGNAL_ICONS[signal.type] ?? '•';
  const time = new Date(signal.timestamp).toLocaleTimeString('en', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const dataSummary = summarizeSignalData(signal);

  entry.innerHTML = `
    <span class="signal-type">${icon} ${signal.type}</span>
    <span class="signal-time">${time}</span>
    <span class="signal-data">${dataSummary}</span>
  `;

  container.prepend(entry);

  // Keep log size manageable
  while (container.children.length > MAX_LOG_ENTRIES) {
    container.lastChild?.remove();
  }
}

function summarizeSignalData(signal: Signal): string {
  const d = signal.data;
  switch (signal.type) {
    case 'page_visit':
      return String(d.title ?? d.url ?? '');
    case 'scroll_depth':
      return `${Math.round((d.depth as number) * 100)}%`;
    case 'click_target':
      return String(d.text ?? d.selector ?? '');
    case 'hover_dwell':
      return `${d.dwellMs}ms on ${d.selector ?? 'element'}`;
    case 'navigation':
      return `→ ${d.to ?? ''}`;
    case 'search_query':
      return String(d.query ?? '');
    case 'form_interaction':
      return `${d.action} ${d.fieldName ?? ''}`;
    default:
      return JSON.stringify(d).slice(0, 60);
  }
}

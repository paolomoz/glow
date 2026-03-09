// extension/panel/components/timing-breakdown.ts — Per-block latency waterfall
// CC-3.3.6: Waterfall chart against the 2.5s budget line

import type { BlockReplacement } from '@glow/core';
import { MAX_GENERATION_TIME_MS } from '@glow/core';

export interface TimingEntry {
  label: string;
  startMs: number;
  durationMs: number;
  color: string;
}

/** Render timing waterfall for generated blocks. */
export function renderTimingBreakdown(
  container: HTMLElement,
  blocks: BlockReplacement[],
  totalTimeMs: number,
): void {
  if (blocks.length === 0) {
    container.innerHTML = '<div class="empty-state">No timing data</div>';
    return;
  }

  container.innerHTML = '';

  // Total pipeline time
  const totalBar = createTimingBar(
    'Total',
    totalTimeMs,
    MAX_GENERATION_TIME_MS,
    totalTimeMs > MAX_GENERATION_TIME_MS ? '#ef4444' : '#22c55e',
  );
  container.appendChild(totalBar);

  // Per-block bars
  for (const block of blocks) {
    const color = block.generationTimeMs > 1500 ? '#f59e0b' : '#8b5cf6';
    const bar = createTimingBar(
      block.templateId.slice(0, 12),
      block.generationTimeMs,
      MAX_GENERATION_TIME_MS,
      color,
    );
    container.appendChild(bar);
  }

  // Budget indicator
  const budgetNote = document.createElement('div');
  budgetNote.style.cssText =
    'font-size: 10px; color: var(--glow-muted); margin-top: 4px; text-align: right;';
  budgetNote.textContent = `Budget: ${MAX_GENERATION_TIME_MS}ms`;
  container.appendChild(budgetNote);
}

function createTimingBar(
  label: string,
  durationMs: number,
  budgetMs: number,
  color: string,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'timing-bar';

  const widthPct = Math.min(100, (durationMs / budgetMs) * 100);

  row.innerHTML = `
    <span class="timing-label">${label}</span>
    <div class="timing-track">
      <div class="timing-fill" style="width: ${widthPct}%; background: ${color};"></div>
      <div class="budget-line"></div>
    </div>
    <span class="timing-value">${durationMs}ms</span>
  `;

  return row;
}

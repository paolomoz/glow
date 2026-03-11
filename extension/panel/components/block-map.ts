// extension/panel/components/block-map.ts — Block visualization
// CC-3.3.4 + CC-3.3.5: Block list showing original vs generative blocks

import type { BlockReplacement } from '@glow/core';

export interface BlockEntry {
  block: BlockReplacement;
  pageUrl: string;
  timestamp: number;
  source?: 'signals' | 'chatgpt';
}

/** Render the block list showing generated blocks. */
export function renderBlockList(
  container: HTMLElement,
  blocks: BlockEntry[],
): void {
  if (blocks.length === 0) {
    container.innerHTML = '<div class="empty-state">No blocks generated</div>';
    return;
  }

  container.innerHTML = '';

  for (const entry of blocks) {
    const item = document.createElement('div');
    item.className = 'block-item';

    const timeMs = entry.block.generationTimeMs;
    const confidence = Math.round(entry.block.confidence * 100);
    const source = entry.source ?? entry.block.source ?? 'signals';
    const sourceBadge = `<span class="source-badge ${source}">${source}</span>`;

    item.innerHTML = `
      <span class="block-indicator generated"></span>
      ${sourceBadge}
      <span>${entry.block.templateId}</span>
      <span class="block-meta">${entry.block.model} · ${timeMs}ms · ${confidence}%</span>
    `;

    // Click to inspect
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      showBlockInspector(container, entry);
    });

    container.appendChild(item);
  }
}

/** Show detailed inspector for a block (CC-3.3.5). */
function showBlockInspector(
  container: HTMLElement,
  entry: BlockEntry,
): void {
  const inspector = document.createElement('div');
  inspector.style.cssText = `
    background: var(--glow-surface);
    border: 1px solid var(--glow-border);
    border-radius: 6px;
    padding: 12px;
    margin-top: 8px;
    font-size: 11px;
  `;

  const b = entry.block;
  inspector.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <strong>Block Inspector</strong>
      <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" id="close-inspector">✕</button>
    </div>
    <dl class="intent-details">
      <dt>Template</dt><dd>${b.templateId}</dd>
      <dt>Selector</dt><dd style="font-family: monospace">${b.selector}</dd>
      <dt>Model</dt><dd>${b.model}</dd>
      <dt>Gen Time</dt><dd>${b.generationTimeMs}ms</dd>
      <dt>Confidence</dt><dd>${Math.round(b.confidence * 100)}%</dd>
      <dt>Atoms Used</dt><dd>${b.atomIds.length} atoms</dd>
      <dt>Source</dt><dd><span class="source-badge ${entry.source ?? 'signals'}">${entry.source ?? 'signals'}</span></dd>
      <dt>Page</dt><dd>${entry.pageUrl}</dd>
    </dl>
    ${b.atomIds.length > 0 ? `
    <div style="margin-top: 8px; color: var(--glow-muted);">
      Atom IDs: ${b.atomIds.join(', ')}
    </div>` : ''}
  `;

  // Remove existing inspector
  const existing = container.querySelector('[data-inspector]');
  if (existing) existing.remove();

  inspector.setAttribute('data-inspector', 'true');
  container.appendChild(inspector);

  inspector.querySelector('#close-inspector')?.addEventListener('click', () => {
    inspector.remove();
  });
}

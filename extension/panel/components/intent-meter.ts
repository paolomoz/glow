// extension/panel/components/intent-meter.ts — Confidence visualization
// CC-3.3.2: Confidence gauge, archetype label, topic keywords

import type { IntentVector } from '@glow/core';

const ARCHETYPE_COLORS: Record<string, string> = {
  explore: '#3b82f6',     // blue
  compare: '#f59e0b',     // amber
  dive_deep: '#8b5cf6',   // purple
  seek_action: '#22c55e', // green
  return: '#94a3b8',      // gray
};

const LEVEL_COLORS = {
  none: '#6b7280',
  subtle: '#3b82f6',
  moderate: '#f59e0b',
  full: '#22c55e',
};

/** Render the intent meter into the given container. */
export function renderIntentMeter(
  container: HTMLElement,
  intent: IntentVector,
): void {
  const confidence = Math.round(intent.confidence * 100);
  const color = ARCHETYPE_COLORS[intent.archetype] ?? '#8b5cf6';

  let level: string;
  let levelColor: string;
  if (intent.confidence < 0.3) {
    level = 'none';
    levelColor = LEVEL_COLORS.none;
  } else if (intent.confidence < 0.6) {
    level = 'subtle';
    levelColor = LEVEL_COLORS.subtle;
  } else if (intent.confidence < 0.8) {
    level = 'moderate';
    levelColor = LEVEL_COLORS.moderate;
  } else {
    level = 'full';
    levelColor = LEVEL_COLORS.full;
  }

  container.innerHTML = `
    <div class="intent-meter">
      <div class="confidence-bar">
        <div class="confidence-fill" style="width: ${confidence}%; background: ${color};"></div>
      </div>
      <div class="confidence-value" style="color: ${color}">${confidence}%</div>
    </div>
    <dl class="intent-details">
      <dt>Archetype</dt>
      <dd>
        <span class="archetype-badge" style="background: ${color}20; color: ${color}">
          ${intent.archetype.replace('_', ' ')}
        </span>
      </dd>
      <dt>Level</dt>
      <dd style="color: ${levelColor}">${level}</dd>
      <dt>Depth</dt>
      <dd>${intent.contentDepth}</dd>
      <dt>Signals</dt>
      <dd>${intent.signalCount}</dd>
      <dt>Audience</dt>
      <dd>${intent.audienceMode}</dd>
    </dl>
  `;
}

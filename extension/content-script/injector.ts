// extension/content-script/injector.ts — Block replacement + AI badge in live DOM
// SLICC-3.2.3: Crossfade injection with layout shift prevention

import type { BlockReplacement } from '@glow/core';

/** Stores original HTML for toggle functionality (SLICC-3.2.5). */
const originalBlocks = new Map<string, string>();

/**
 * Inject generated blocks into the live DOM.
 * Uses crossfade transition and preserves original content for toggle.
 */
export function injectBlocks(blocks: BlockReplacement[]): void {
  for (const block of blocks) {
    injectBlock(block);
  }
}

/**
 * Inject a single block replacement.
 * - Finds target element by selector
 * - Preserves original HTML
 * - Crossfade transition (200ms)
 * - Adds AI provenance badge
 */
function injectBlock(block: BlockReplacement): void {
  const target = document.querySelector(block.selector);
  if (!target || !(target instanceof HTMLElement)) return;

  // Store original content for toggle
  if (!originalBlocks.has(block.selector)) {
    originalBlocks.set(block.selector, target.innerHTML);
  }

  // Match dimensions to prevent layout shift
  const rect = target.getBoundingClientRect();
  const computedStyle = getComputedStyle(target);

  // Create wrapper for crossfade
  const wrapper = document.createElement('div');
  wrapper.className = 'glow-block-wrapper';
  wrapper.setAttribute('data-glow-injected', 'true');
  wrapper.setAttribute('data-template-id', block.templateId);
  wrapper.style.cssText = `
    position: relative;
    min-height: ${rect.height}px;
    overflow: hidden;
  `;

  // Set the generated HTML
  wrapper.innerHTML = block.html;

  // Add AI badge
  const badge = createBadge(block);
  wrapper.appendChild(badge);

  // Crossfade: start transparent, fade in
  wrapper.style.opacity = '0';
  wrapper.style.transition = 'opacity 200ms ease-in-out';

  // Fade out original
  target.style.transition = 'opacity 200ms ease-in-out';
  target.style.opacity = '0';

  setTimeout(() => {
    // Replace content
    target.style.opacity = '';
    target.style.transition = '';
    target.innerHTML = '';
    target.appendChild(wrapper);

    // Fade in
    requestAnimationFrame(() => {
      wrapper.style.opacity = '1';
    });
  }, 200);
}

/**
 * Create the AI provenance badge (✦ icon).
 * Positioned top-right of the block. Click to toggle original/generated.
 */
function createBadge(block: BlockReplacement): HTMLElement {
  const badge = document.createElement('button');
  badge.className = 'glow-badge';
  badge.setAttribute('aria-label', 'AI-generated content — click to toggle');
  badge.setAttribute('title', `Glow ✦ ${block.model} · ${block.generationTimeMs}ms`);
  badge.innerHTML = '✦';

  badge.style.cssText = `
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(139, 92, 246, 0.9);
    color: white;
    border: none;
    cursor: pointer;
    font-size: 12px;
    line-height: 24px;
    text-align: center;
    z-index: 10000;
    opacity: 0.7;
    transition: opacity 150ms;
    font-family: system-ui, sans-serif;
    padding: 0;
  `;

  badge.addEventListener('mouseenter', () => {
    badge.style.opacity = '1';
  });

  badge.addEventListener('mouseleave', () => {
    badge.style.opacity = '0.7';
  });

  // Toggle original vs generated on click
  let showingOriginal = false;
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const wrapper = badge.parentElement;
    if (!wrapper) return;

    const container = wrapper.parentElement;
    if (!container) return;

    const originalHtml = originalBlocks.get(block.selector);
    if (!originalHtml) return;

    if (showingOriginal) {
      // Restore generated
      wrapper.innerHTML = block.html;
      wrapper.appendChild(badge);
      badge.innerHTML = '✦';
      badge.style.background = 'rgba(139, 92, 246, 0.9)';
    } else {
      // Show original
      wrapper.innerHTML = originalHtml;
      wrapper.appendChild(badge);
      badge.innerHTML = '↩';
      badge.style.background = 'rgba(107, 114, 128, 0.9)';
    }

    showingOriginal = !showingOriginal;
  });

  return badge;
}

/**
 * Restore all injected blocks to their original content.
 */
export function restoreAll(): void {
  for (const [selector, originalHtml] of originalBlocks) {
    const target = document.querySelector(selector);
    if (target instanceof HTMLElement) {
      target.innerHTML = originalHtml;
    }
  }
  originalBlocks.clear();
}

/**
 * Check if a specific block has been injected.
 */
export function isInjected(selector: string): boolean {
  return originalBlocks.has(selector);
}

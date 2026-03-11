// extension/content-script/injector.ts — In-place DOM modification
// Supports: text replacement, image swapping, and new content insertion

import type { BlockReplacement } from '@glow/core';

/** Stores original values per block for toggle functionality. */
const originalTexts = new Map<string, Map<string, string>>();
/** Stores original <source> srcsets so image toggle fully restores <picture> elements. */
const originalSrcsets = new Map<string, Map<string, { srcsets: [string, string][]; imgSrcset: string }>>();
/** Tracks inserted elements so they can be removed on toggle/restore. */
const insertedElements = new Map<string, HTMLElement>();

/**
 * Inject generated blocks into the live DOM.
 */
export function injectBlocks(blocks: BlockReplacement[]): void {
  for (const block of blocks) {
    injectBlock(block);
  }
}

function injectBlock(block: BlockReplacement): void {
  // Skip if already injected for this selector
  if (originalTexts.has(block.selector)) return;

  console.log(`[glow] injectBlock: selector=${block.selector}, insertAfter=${!!block.insertAfter}, hasSlotSelectors=${!!block.slotSelectors}, hasSlotValues=${!!block.slotValues}`);

  const reference = document.querySelector(block.selector);
  if (!reference || !(reference instanceof HTMLElement)) {
    console.warn(`[glow] Selector not found: "${block.selector}"`);
    return;
  }

  // Mode 1: Insert new content after the reference element
  if (block.insertAfter) {
    injectInsertedBlock(block, reference);
    return;
  }

  // Mode 2: In-place replacement (text + images)
  if (block.slotSelectors && block.slotValues) {
    injectInPlace(block, reference);
    return;
  }

  // Mode 3: Fallback overlay
  injectOverlay(block, reference);
}

// ---------------------------------------------------------------------------
// Mode 1: Insert new content after a reference element
// ---------------------------------------------------------------------------

function injectInsertedBlock(block: BlockReplacement, reference: HTMLElement): void {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-glow-injected', 'true');
  wrapper.setAttribute('data-glow-inserted', 'true');
  wrapper.setAttribute('data-template-id', block.templateId);
  wrapper.innerHTML = block.html;
  wrapper.style.position = 'relative';

  // Fade-in animation
  wrapper.style.opacity = '0';
  wrapper.style.transition = 'opacity 500ms ease-in-out';

  // Add badge
  const badge = createBadge(block, wrapper, 'inserted');
  wrapper.appendChild(badge);

  // Insert after the reference element
  reference.parentElement?.insertBefore(wrapper, reference.nextSibling);
  insertedElements.set(block.selector, wrapper);
  originalTexts.set(block.selector, new Map([['__inserted__', 'true']]));

  requestAnimationFrame(() => {
    wrapper.style.opacity = '1';
  });

  console.log(`[glow] Inserted new block after "${block.selector}"`);
}

// ---------------------------------------------------------------------------
// Mode 2: In-place text + image replacement
// ---------------------------------------------------------------------------

function injectInPlace(block: BlockReplacement, container: HTMLElement): void {
  const originals = new Map<string, string>();

  for (const [slotName, cssSelector] of Object.entries(block.slotSelectors!)) {
    const value = block.slotValues![slotName];
    if (!value) {
      console.warn(`[glow] Slot "${slotName}" has no value, skipping`);
      continue;
    }

    const el = container.querySelector(cssSelector);
    if (!el || !(el instanceof HTMLElement)) {
      console.warn(`[glow] Slot selector not found: "${cssSelector}" in "${block.selector}"`);
      continue;
    }

    // Auto-detect element type for replacement strategy
    if (isImageElement(el)) {
      // Image replacement — only apply valid URLs that look like real image resources
      if (!value.startsWith('http') || !looksLikeImageUrl(value)) {
        console.warn(`[glow] Image "${slotName}": skipping non-image or hallucinated URL: "${value.substring(0, 80)}"`);
        continue;
      }
      const originalSrc = getImageSrc(el);
      originals.set(cssSelector, originalSrc);
      // Save full <source> srcsets for proper restore on toggle
      savePictureSrcsets(block.selector, cssSelector, el);
      replaceImage(el, value);
      console.log(`[glow] Image "${slotName}": swapped src → ${value.substring(0, 80)}`);
    } else {
      // Text replacement
      const originalText = el.textContent ?? '';
      originals.set(cssSelector, originalText);
      replaceTextContent(el, value);
      console.log(`[glow] Text "${slotName}": "${originalText.trim().substring(0, 50)}" → "${value.substring(0, 50)}"`);
    }

    el.setAttribute('data-glow-modified', 'true');
  }

  originalTexts.set(block.selector, originals);
  container.setAttribute('data-glow-injected', 'true');
  container.setAttribute('data-template-id', block.templateId);

  const containerStyle = getComputedStyle(container);
  if (containerStyle.position === 'static') {
    container.style.position = 'relative';
  }

  const badge = createBadge(block, container, 'inplace');
  container.appendChild(badge);

  // Subtle highlight
  container.style.transition = 'outline 300ms ease-in-out';
  container.style.outline = '2px solid rgba(139, 92, 246, 0.4)';
  setTimeout(() => { container.style.outline = 'none'; }, 1500);
}

// ---------------------------------------------------------------------------
// Mode 3: Fallback overlay
// ---------------------------------------------------------------------------

function injectOverlay(block: BlockReplacement, target: HTMLElement): void {
  const originals = new Map<string, string>();
  originals.set('__html__', target.innerHTML);
  originalTexts.set(block.selector, originals);

  const overlay = document.createElement('div');
  overlay.className = 'glow-block-overlay';
  overlay.setAttribute('data-glow-injected', 'true');
  overlay.setAttribute('data-template-id', block.templateId);
  overlay.innerHTML = block.html;
  overlay.style.cssText = `position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:center;`;

  if (getComputedStyle(target).position === 'static') {
    target.style.position = 'relative';
  }

  const badge = createBadge(block, target, 'overlay');
  overlay.appendChild(badge);

  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 300ms ease-in-out';
  target.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function isImageElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return true;
  if (tag === 'picture') return true;
  // Check if element's primary child is an img
  if (el.querySelector(':scope > img, :scope > picture > img')) return true;
  return false;
}

function getImageSrc(el: HTMLElement): string {
  const img = el.tagName === 'IMG' ? el as HTMLImageElement
    : el.querySelector('img') as HTMLImageElement | null;
  return img?.src ?? '';
}

function replaceImage(el: HTMLElement, newSrc: string): void {
  // Handle <img> directly
  if (el.tagName === 'IMG') {
    (el as HTMLImageElement).src = newSrc;
    el.removeAttribute('srcset');
    el.removeAttribute('loading');
    return;
  }

  // Handle <picture> or container with <picture>
  const picture = el.tagName === 'PICTURE' ? el : el.querySelector('picture');
  if (picture) {
    const img = picture.querySelector('img') as HTMLImageElement | null;
    if (img) {
      // Replace <source> srcsets with the new image URL (preserving media queries)
      picture.querySelectorAll('source').forEach(source => {
        const media = source.getAttribute('media') ?? '';
        // Replace entire srcset with new URL — don't try to parse/mangle the old one
        source.setAttribute('srcset', newSrc);
      });

      // Update the <img> itself
      img.src = newSrc;
      img.removeAttribute('srcset');
      img.removeAttribute('loading');
    }
    return;
  }

  // Fallback: find any img descendant
  const img = el.querySelector('img') as HTMLImageElement | null;
  if (img) {
    img.src = newSrc;
    img.srcset = '';
  }
}

// ---------------------------------------------------------------------------
// Picture srcset save/restore (for proper toggle of <picture> elements)
// ---------------------------------------------------------------------------

/** Save the full <source> srcsets and <img> srcset for a <picture> element. */
function savePictureSrcsets(blockSelector: string, slotSelector: string, el: HTMLElement): void {
  const picture = el.tagName === 'PICTURE' ? el : el.querySelector('picture');
  if (!picture) return;

  const srcsets: [string, string][] = [];
  picture.querySelectorAll('source').forEach(source => {
    srcsets.push([
      source.getAttribute('media') ?? '',
      source.getAttribute('srcset') ?? '',
    ]);
  });

  const img = picture.querySelector('img') as HTMLImageElement | null;
  const imgSrcset = img?.getAttribute('srcset') ?? '';

  if (!originalSrcsets.has(blockSelector)) {
    originalSrcsets.set(blockSelector, new Map());
  }
  originalSrcsets.get(blockSelector)!.set(slotSelector, { srcsets, imgSrcset });
}

/** Restore original <source> srcsets for a <picture> element. */
function restorePictureSrcsets(blockSelector: string, slotSelector: string, el: HTMLElement): void {
  const saved = originalSrcsets.get(blockSelector)?.get(slotSelector);
  if (!saved) return;

  const picture = el.tagName === 'PICTURE' ? el : el.querySelector('picture');
  if (!picture) return;

  const sources = picture.querySelectorAll('source');
  saved.srcsets.forEach(([media, srcset], i) => {
    if (sources[i]) {
      sources[i].setAttribute('srcset', srcset);
    }
  });

  const img = picture.querySelector('img') as HTMLImageElement | null;
  if (img && saved.imgSrcset) {
    img.setAttribute('srcset', saved.imgSrcset);
  }
}

/** Check if a URL looks like a real image (has an image file extension or known CDN pattern). */
function looksLikeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    // Check for common image extensions
    if (/\.(jpe?g|png|webp|avif|gif|svg|bmp|ico)$/.test(path)) return true;
    // Check for CDN image patterns (query-based resizing)
    if (parsed.searchParams.has('imwidth') || parsed.searchParams.has('w') || parsed.searchParams.has('width')) return true;
    // Check for known image CDN paths
    if (path.includes('/dam/') || path.includes('/images/') || path.includes('/media/') || path.includes('/assets/')) return true;
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Text replacement
// ---------------------------------------------------------------------------

function replaceTextContent(el: HTMLElement, newText: string): void {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent && node.textContent.trim().length > 0) {
      textNodes.push(node);
    }
  }

  if (textNodes.length === 0) {
    el.textContent = newText;
    return;
  }

  textNodes[0].textContent = newText;
  for (let i = 1; i < textNodes.length; i++) {
    textNodes[i].textContent = '';
  }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function createBadge(
  block: BlockReplacement,
  container: HTMLElement,
  mode: 'inplace' | 'inserted' | 'overlay',
): HTMLElement {
  const badge = document.createElement('button');
  badge.className = 'glow-badge';
  badge.setAttribute('aria-label', 'AI-generated content — click to toggle');
  const sourceLabel = block.source === 'chatgpt' ? 'ChatGPT' : 'Signals';
  badge.setAttribute('title', `Glow ✦ ${sourceLabel} · ${block.model} · ${block.generationTimeMs}ms`);
  const isChatGpt = block.source === 'chatgpt';
  badge.innerHTML = isChatGpt ? '💬' : '✦';

  const badgeColor = isChatGpt ? 'rgba(16, 163, 127, 0.9)' : 'rgba(139, 92, 246, 0.9)';
  badge.style.cssText = `
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: ${badgeColor};
    color: white;
    border: none;
    cursor: pointer;
    font-size: 12px;
    line-height: 24px;
    text-align: center;
    z-index: 2147483647;
    opacity: 0.7;
    transition: opacity 150ms;
    font-family: system-ui, sans-serif;
    padding: 0;
    isolation: isolate;
    pointer-events: auto;
  `;

  badge.addEventListener('mouseenter', () => { badge.style.opacity = '1'; });
  badge.addEventListener('mouseleave', () => { badge.style.opacity = '0.7'; });

  let showingOriginal = false;
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const originals = originalTexts.get(block.selector);
    if (!originals) return;

    if (mode === 'inserted') {
      // Toggle inserted block visibility
      const inserted = insertedElements.get(block.selector);
      if (!inserted) return;
      if (showingOriginal) {
        inserted.style.opacity = '1';
        inserted.style.maxHeight = '';
      } else {
        inserted.style.opacity = '0.2';
        inserted.style.maxHeight = '40px';
        inserted.style.overflow = 'hidden';
      }
    } else if (mode === 'inplace' && block.slotSelectors && block.slotValues) {
      for (const [slotName, cssSelector] of Object.entries(block.slotSelectors)) {
        const el = container.querySelector(cssSelector);
        if (!el || !(el instanceof HTMLElement)) continue;

        if (showingOriginal) {
          // Re-apply generated values
          const value = block.slotValues[slotName];
          if (value) {
            if (isImageElement(el)) replaceImage(el, value);
            else replaceTextContent(el, value);
          }
        } else {
          // Restore original values
          if (isImageElement(el)) {
            // Restore saved <source> srcsets for proper <picture> restoration
            const originalSrc = originals.get(cssSelector);
            if (originalSrc !== undefined) {
              restorePictureSrcsets(block.selector, cssSelector, el);
              // Also restore the <img> src
              const img = el.tagName === 'IMG' ? el as HTMLImageElement
                : el.querySelector('img') as HTMLImageElement | null;
              if (img) img.src = originalSrc;
            }
          } else {
            const original = originals.get(cssSelector);
            if (original !== undefined) {
              replaceTextContent(el, original);
            }
          }
        }
      }
    } else {
      const overlay = badge.parentElement;
      if (overlay) overlay.style.opacity = showingOriginal ? '1' : '0';
    }

    badge.innerHTML = showingOriginal ? (isChatGpt ? '💬' : '✦') : '↩';
    badge.style.background = showingOriginal
      ? badgeColor
      : 'rgba(107, 114, 128, 0.9)';
    showingOriginal = !showingOriginal;
  });

  return badge;
}

// ---------------------------------------------------------------------------
// Restore / query
// ---------------------------------------------------------------------------

export function restoreAll(): void {
  // Remove inserted elements
  for (const [, el] of insertedElements) {
    el.remove();
  }
  insertedElements.clear();

  for (const [selector, originals] of originalTexts) {
    const container = document.querySelector(selector);
    if (!(container instanceof HTMLElement)) continue;

    const overlay = container.querySelector('.glow-block-overlay');
    if (overlay) overlay.remove();
    const badge = container.querySelector('.glow-badge');
    if (badge) badge.remove();

    for (const [cssSelector, value] of originals) {
      if (cssSelector.startsWith('__')) continue;
      const el = container.querySelector(cssSelector);
      if (el instanceof HTMLElement) {
        if (isImageElement(el)) {
          restorePictureSrcsets(selector, cssSelector, el);
          const img = el.tagName === 'IMG' ? el as HTMLImageElement
            : el.querySelector('img') as HTMLImageElement | null;
          if (img) img.src = value;
        } else {
          replaceTextContent(el, value);
        }
        el.removeAttribute('data-glow-modified');
      }
    }

    container.removeAttribute('data-glow-injected');
    container.removeAttribute('data-template-id');
    container.style.position = '';
  }
  originalTexts.clear();
  originalSrcsets.clear();
}

export function isInjected(selector: string): boolean {
  return originalTexts.has(selector);
}

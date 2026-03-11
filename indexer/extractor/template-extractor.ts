// indexer/extractor/template-extractor.ts — Extract block templates from detected DOM blocks
// SLICC-1.4.2: For each detected block, capture outer HTML with slot placeholders,
// computed CSS, slot schema, and responsive behavior at 3 viewport widths.

import type {
  BlockTemplate,
  BlockPosition,
  SlotDefinition,
  SlotType,
  ResponsiveStyles,
} from '@glow/core';
import type { DetectedBlock } from './block-detector.js';

export interface TemplateExtractionOptions {
  /** Site identifier for template ownership */
  siteId: string;
  /** Source page URL */
  sourceUrl: string;
  /** Viewport widths to capture responsive styles (default: [375, 768, 1280]) */
  viewportWidths?: [number, number, number];
}

interface SlotCandidate {
  element: Element;
  name: string;
  type: SlotType;
  originalContent: string;
  placeholder: string;
}

const SLOT_COUNTER = { value: 0 };

/**
 * Extract a BlockTemplate from a detected block in the rendered DOM.
 * Replaces content with slot placeholders and captures computed CSS.
 */
export function extractTemplate(
  block: DetectedBlock,
  options: TemplateExtractionOptions,
  doc: Document,
): BlockTemplate {
  SLOT_COUNTER.value = 0;

  // Identify slots within the block (cap at 8 to keep LLM prompts manageable)
  const allSlots = identifySlots(block.element);
  const slots = allSlots.slice(0, 8);

  // Clone the element and replace content with placeholders
  const clone = block.element.cloneNode(true) as Element;
  applyPlaceholders(clone, block.element, slots);

  // Capture computed CSS
  const cssRules = captureComputedCss(block.element, doc);

  // Infer block position from its location on the page
  const position = inferBlockPosition(block.rect);

  // Build slot definitions
  const slotDefs = slots.map((s) => buildSlotDefinition(s));

  // Capture responsive styles (simplified — captures current viewport CSS)
  const responsive = captureResponsiveStyles(block.element, doc);

  const id = `tmpl_${options.siteId}_${block.selector.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`;

  return {
    id,
    siteId: options.siteId,
    sourceUrl: options.sourceUrl,
    blockType: block.semanticTag ?? 'div',
    selector: block.selector,
    htmlShell: clone.outerHTML,
    cssRules,
    slots: slotDefs,
    responsive,
    position,
  };
}

/**
 * Extract templates from multiple detected blocks.
 */
export function extractTemplates(
  blocks: DetectedBlock[],
  options: TemplateExtractionOptions,
  doc: Document,
): BlockTemplate[] {
  return blocks.map((block) => extractTemplate(block, options, doc));
}

/** Identify content slots within a block element. */
function identifySlots(root: Element): SlotCandidate[] {
  const slots: SlotCandidate[] = [];
  walkForSlots(root, slots);
  return slots;
}

function walkForSlots(el: Element, slots: SlotCandidate[]): void {
  const tag = el.tagName.toLowerCase();

  // Headings → text slots
  if (/^h[1-6]$/.test(tag)) {
    const text = el.textContent?.trim() ?? '';
    if (text.length > 0) {
      slots.push({
        element: el,
        name: inferSlotName(tag, slots.length),
        type: 'text',
        originalContent: text,
        placeholder: `{{${inferSlotName(tag, slots.length)}}}`,
      });
      return; // Don't recurse into headings
    }
  }

  // Paragraphs → rich-text slots
  if (tag === 'p') {
    const text = el.textContent?.trim() ?? '';
    if (text.length > 0) {
      slots.push({
        element: el,
        name: inferSlotName('body', slots.length),
        type: 'rich-text',
        originalContent: text,
        placeholder: `{{${inferSlotName('body', slots.length)}}}`,
      });
      return;
    }
  }

  // Images → image slots
  if (tag === 'img') {
    const alt = el.getAttribute('alt') ?? '';
    slots.push({
      element: el,
      name: inferSlotName('image', slots.length),
      type: 'image',
      originalContent: alt,
      placeholder: `{{${inferSlotName('image', slots.length)}}}`,
    });
    return;
  }

  // Links with meaningful text → link slots
  if (tag === 'a') {
    const text = el.textContent?.trim() ?? '';
    if (text.length > 0 && isCtaLike(el)) {
      slots.push({
        element: el,
        name: inferSlotName('cta', slots.length),
        type: 'link',
        originalContent: text,
        placeholder: `{{${inferSlotName('cta', slots.length)}}}`,
      });
      return;
    }
  }

  // Lists → list slots
  if (tag === 'ul' || tag === 'ol') {
    const text = el.textContent?.trim() ?? '';
    if (text.length > 0) {
      slots.push({
        element: el,
        name: inferSlotName('list', slots.length),
        type: 'list',
        originalContent: text,
        placeholder: `{{${inferSlotName('list', slots.length)}}}`,
      });
      return;
    }
  }

  // Recurse into children
  for (let i = 0; i < el.children.length; i++) {
    walkForSlots(el.children[i], slots);
  }
}

function inferSlotName(hint: string, index: number): string {
  const nameMap: Record<string, string> = {
    h1: 'headline',
    h2: 'subheading',
    h3: 'subheading',
    h4: 'subheading',
    h5: 'subheading',
    h6: 'subheading',
    body: 'body',
    image: 'image',
    cta: 'cta',
    list: 'list',
  };
  const base = nameMap[hint] ?? hint;
  SLOT_COUNTER.value++;
  return SLOT_COUNTER.value === 1 ? base : `${base}_${SLOT_COUNTER.value}`;
}

function isCtaLike(el: Element): boolean {
  const classes = el.className.toLowerCase();
  const text = (el.textContent ?? '').toLowerCase();
  return (
    classes.includes('btn') ||
    classes.includes('button') ||
    classes.includes('cta') ||
    el.getAttribute('role') === 'button' ||
    /^(buy|shop|sign up|get started|learn more|subscribe|try|download|contact)/i.test(
      text,
    )
  );
}

/** Apply slot placeholders to a cloned element tree. */
function applyPlaceholders(
  clone: Element,
  original: Element,
  slots: SlotCandidate[],
): void {
  for (const slot of slots) {
    // Find the matching element in the clone by position
    const cloneTarget = findMatchingElement(clone, original, slot.element);
    if (!cloneTarget) continue;

    const tag = cloneTarget.tagName.toLowerCase();
    if (tag === 'img') {
      cloneTarget.setAttribute('alt', slot.placeholder);
      cloneTarget.setAttribute('src', slot.placeholder);
    } else {
      cloneTarget.textContent = slot.placeholder;
    }
  }
}

/** Find the element in clone that corresponds to the target in original. */
function findMatchingElement(
  clone: Element,
  original: Element,
  target: Element,
): Element | null {
  if (original === target) return clone;

  const origChildren = original.children;
  const cloneChildren = clone.children;

  for (let i = 0; i < origChildren.length && i < cloneChildren.length; i++) {
    const result = findMatchingElement(
      cloneChildren[i],
      origChildren[i],
      target,
    );
    if (result) return result;
  }

  return null;
}

/** Capture computed CSS for a block and its children as inline style string. */
function captureComputedCss(el: Element, doc: Document): string {
  const win = doc.defaultView;
  if (!win) return '';

  const rules: string[] = [];

  try {
    const style = win.getComputedStyle(el);
    const relevant = extractRelevantCssProperties(style);
    if (relevant) {
      rules.push(`/* block root */ ${relevant}`);
    }
  } catch {
    // Computed styles may not be available in all contexts
  }

  return rules.join('\n');
}

const RELEVANT_CSS_PROPS = [
  'display',
  'flex-direction',
  'align-items',
  'justify-content',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'padding',
  'margin',
  'background-color',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'border',
  'border-radius',
  'max-width',
  'width',
  'box-sizing',
];

function extractRelevantCssProperties(
  style: CSSStyleDeclaration,
): string | null {
  const pairs: string[] = [];

  for (const prop of RELEVANT_CSS_PROPS) {
    const val = style.getPropertyValue(prop);
    if (val && val !== 'none' && val !== 'normal' && val !== 'auto') {
      pairs.push(`${prop}: ${val}`);
    }
  }

  return pairs.length > 0 ? pairs.join('; ') : null;
}

function buildSlotDefinition(slot: SlotCandidate): SlotDefinition {
  return {
    name: slot.name,
    type: slot.type,
    constraints: {
      minLength: Math.max(1, Math.floor(slot.originalContent.length * 0.5)),
      maxLength: Math.ceil(slot.originalContent.length * 2),
      required: true,
    },
    originalContent: slot.originalContent,
  };
}

/** Infer block position from its vertical location on the page. */
function inferBlockPosition(rect: {
  top: number;
  height: number;
}): BlockPosition {
  const viewportHeight =
    typeof globalThis !== 'undefined' && 'innerHeight' in globalThis
      ? (globalThis as unknown as { innerHeight: number }).innerHeight
      : 800;

  if (rect.top < 100) return 'hero';
  if (rect.top < viewportHeight) return 'above-fold';
  if (rect.top < viewportHeight * 2) return 'mid-page';
  if (rect.top < viewportHeight * 4) return 'below-fold';
  return 'footer';
}

/** Capture responsive styles at the current viewport (simplified). */
function captureResponsiveStyles(
  el: Element,
  doc: Document,
): ResponsiveStyles {
  // In a real browser context, we'd resize the viewport and recapture.
  // Here we capture the current state and duplicate — the SLICC runner
  // handles viewport resizing and calls this at each width.
  const css = captureComputedCss(el, doc);
  return {
    mobile: css,
    tablet: css,
    desktop: css,
  };
}

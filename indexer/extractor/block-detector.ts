// indexer/extractor/block-detector.ts — Heuristic block boundary detection on rendered DOM
// SLICC-1.4.1: Detect discrete content sections using DOM structure, semantic elements,
// visual gaps, and background color boundaries.

/** Represents a detected content block boundary in the DOM. */
export interface DetectedBlock {
  /** The root element of this block */
  element: Element;
  /** CSS selector that uniquely identifies this element */
  selector: string;
  /** Semantic tag name if applicable (section, article, aside, header, footer, main, nav) */
  semanticTag: string | null;
  /** Block depth in the page hierarchy (0 = top-level) */
  depth: number;
  /** Bounding rectangle relative to the document */
  rect: { top: number; left: number; width: number; height: number };
  /** Background color of this block (computed) */
  backgroundColor: string;
  /** Whether this block contains meaningful text content */
  hasContent: boolean;
}

export interface BlockDetectorOptions {
  /** Minimum height in px for a block to be considered (default: 40) */
  minBlockHeight?: number;
  /** Minimum margin/padding gap in px to consider as a boundary (default: 16) */
  gapThreshold?: number;
  /** Maximum DOM depth to search (default: 8) */
  maxDepth?: number;
  /** Minimum text content length to count as "has content" (default: 10) */
  minContentLength?: number;
}

const SEMANTIC_BLOCK_TAGS = new Set([
  'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
]);

const SKIP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'noscript', 'svg', 'iframe',
]);

const DEFAULT_OPTIONS: Required<BlockDetectorOptions> = {
  minBlockHeight: 40,
  gapThreshold: 16,
  maxDepth: 8,
  minContentLength: 10,
};

/**
 * Detect content block boundaries in a rendered DOM document.
 * Uses a combination of semantic elements, DOM depth changes, visual gap analysis,
 * and background color boundaries to identify discrete content sections.
 */
export function detectBlocks(
  doc: Document,
  options: BlockDetectorOptions = {},
): DetectedBlock[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const body = doc.body;
  if (!body) return [];

  const blocks: DetectedBlock[] = [];
  const seen = new WeakSet<Element>();

  walkForBlocks(body, 0, opts, blocks, seen, doc);

  // Filter out blocks that are too small or empty.
  // When no layout engine is available (e.g. jsdom), rect.height is 0 —
  // in that case, skip the height filter and rely on hasContent alone.
  return blocks.filter(
    (b) =>
      b.hasContent &&
      (b.rect.height >= opts.minBlockHeight || b.rect.height === 0),
  );
}

function walkForBlocks(
  el: Element,
  depth: number,
  opts: Required<BlockDetectorOptions>,
  blocks: DetectedBlock[],
  seen: WeakSet<Element>,
  doc: Document,
): void {
  if (depth > opts.maxDepth) return;
  if (seen.has(el)) return;

  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;

  // Check if this element qualifies as a block boundary
  if (isBlockBoundary(el, depth, opts, doc)) {
    // Container semantic elements (main, header, footer, nav) may hold
    // more specific child blocks — recurse into them instead of
    // treating them as leaf sections.
    if (isContainerSemantic(tag) && hasChildSemanticBlocks(el)) {
      const children = el.children;
      for (let i = 0; i < children.length; i++) {
        walkForBlocks(children[i], depth + 1, opts, blocks, seen, doc);
      }
      return;
    }

    seen.add(el);
    blocks.push(buildDetectedBlock(el, depth, opts, doc));
    return;
  }

  // Recurse into children
  const children = el.children;
  for (let i = 0; i < children.length; i++) {
    walkForBlocks(children[i], depth + 1, opts, blocks, seen, doc);
  }
}

const CONTAINER_SEMANTIC_TAGS = new Set(['main', 'header', 'footer', 'nav']);

function isContainerSemantic(tag: string): boolean {
  return CONTAINER_SEMANTIC_TAGS.has(tag);
}

function hasChildSemanticBlocks(el: Element): boolean {
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    const childTag = child.tagName.toLowerCase();
    if (SEMANTIC_BLOCK_TAGS.has(childTag)) return true;
    if (hasChildSemanticBlocks(child)) return true;
  }
  return false;
}

function isBlockBoundary(
  el: Element,
  depth: number,
  opts: Required<BlockDetectorOptions>,
  doc: Document,
): boolean {
  const tag = el.tagName.toLowerCase();

  // Semantic elements are always block boundaries
  if (SEMANTIC_BLOCK_TAGS.has(tag)) return true;

  // Divs with significant visual separation
  if (tag === 'div' || tag === 'form') {
    const style = getComputedStyleSafe(el, doc);
    if (!style) return false;

    // Check for visual gaps (margin or padding creating separation)
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;

    const hasVisualGap =
      marginTop >= opts.gapThreshold ||
      marginBottom >= opts.gapThreshold ||
      paddingTop >= opts.gapThreshold ||
      paddingBottom >= opts.gapThreshold;

    // Check for background color boundary
    const hasBackgroundBoundary = hasDistinctBackground(el, doc);

    // Check for role attributes that indicate a section
    const role = el.getAttribute('role');
    const hasBlockRole =
      role === 'region' ||
      role === 'complementary' ||
      role === 'banner' ||
      role === 'contentinfo' ||
      role === 'main';

    if (hasBlockRole) return true;
    if (hasVisualGap && hasTextContent(el, opts.minContentLength)) return true;
    if (hasBackgroundBoundary && hasTextContent(el, opts.minContentLength))
      return true;
  }

  return false;
}

function hasDistinctBackground(el: Element, doc: Document): boolean {
  const style = getComputedStyleSafe(el, doc);
  const parentStyle = el.parentElement
    ? getComputedStyleSafe(el.parentElement, doc)
    : null;

  if (!style) return false;

  const bg = style.backgroundColor;
  const parentBg = parentStyle?.backgroundColor ?? 'rgba(0, 0, 0, 0)';

  // Transparent backgrounds don't count
  if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;

  return bg !== parentBg;
}

function hasTextContent(el: Element, minLength: number): boolean {
  const text = el.textContent?.trim() ?? '';
  return text.length >= minLength;
}

function buildDetectedBlock(
  el: Element,
  depth: number,
  opts: Required<BlockDetectorOptions>,
  doc: Document,
): DetectedBlock {
  const tag = el.tagName.toLowerCase();
  const style = getComputedStyleSafe(el, doc);
  const rect = getBoundingRectSafe(el);

  return {
    element: el,
    selector: buildUniqueSelector(el),
    semanticTag: SEMANTIC_BLOCK_TAGS.has(tag) ? tag : null,
    depth,
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    backgroundColor: style?.backgroundColor ?? 'rgba(0, 0, 0, 0)',
    hasContent: hasTextContent(el, opts.minContentLength),
  };
}

/**
 * Escape a CSS identifier. Uses the native CSS.escape when available,
 * falls back to a simple escaping implementation for environments
 * without a full CSS API (e.g. jsdom / headless).
 */
function cssEscape(value: string): string {
  if (typeof globalThis !== 'undefined' && 'CSS' in globalThis && typeof (globalThis as any).CSS?.escape === 'function') {
    return (globalThis as any).CSS.escape(value);
  }
  // Simple fallback: escape characters that are not valid in CSS identifiers
  return value.replace(/([^\w-])/g, '\\$1');
}

/** Build a CSS selector that uniquely identifies this element. */
export function buildUniqueSelector(el: Element): string {
  // If element has an id, use it
  if (el.id) return `#${cssEscape(el.id)}`;

  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== current.ownerDocument?.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      parts.unshift(`#${cssEscape(current.id)}`);
      break;
    }

    // Add class names for specificity
    if (current.classList.length > 0) {
      const classes = Array.from(current.classList)
        .slice(0, 2)
        .map((c) => `.${cssEscape(c)}`)
        .join('');
      selector += classes;
    }

    // Add nth-child if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function getComputedStyleSafe(
  el: Element,
  doc: Document,
): CSSStyleDeclaration | null {
  try {
    return doc.defaultView?.getComputedStyle(el) ?? null;
  } catch {
    return null;
  }
}

function getBoundingRectSafe(el: Element): {
  top: number;
  left: number;
  width: number;
  height: number;
} {
  try {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  } catch {
    return { top: 0, left: 0, width: 0, height: 0 };
  }
}

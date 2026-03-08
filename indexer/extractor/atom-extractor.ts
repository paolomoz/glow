// indexer/extractor/atom-extractor.ts — Decompose blocks into content atoms
// SLICC-1.4.3: For each block, extract headlines, subheadings, body paragraphs,
// CTAs, image alt text, list items. Tag each atom with source URL, block position,
// content type, word count. Preserve hierarchy.

import type { ContentAtom, ContentType, ContentMetadata } from '@glow/core';
import type { DetectedBlock } from './block-detector.js';

export interface AtomExtractionOptions {
  /** Source page URL */
  sourceUrl: string;
  /** Minimum word count for body atoms (default: 3) */
  minWordCount?: number;
}

interface RawAtom {
  content: string;
  contentType: ContentType;
  element: Element;
  parentHeading: string | null;
}

const DEFAULT_MIN_WORD_COUNT = 3;

/**
 * Extract content atoms from a detected block.
 * Returns an array of ContentAtom objects with metadata.
 */
export function extractAtoms(
  block: DetectedBlock,
  blockIndex: number,
  options: AtomExtractionOptions,
): ContentAtom[] {
  const minWords = options.minWordCount ?? DEFAULT_MIN_WORD_COUNT;
  const rawAtoms = collectRawAtoms(block.element);

  const now = new Date().toISOString();
  const atoms: ContentAtom[] = [];

  for (const raw of rawAtoms) {
    const wordCount = countWords(raw.content);
    if (raw.contentType !== 'cta' && wordCount < minWords) continue;

    atoms.push({
      id: generateAtomId(options.sourceUrl, blockIndex, atoms.length),
      content: raw.content,
      sourceUrl: options.sourceUrl,
      blockPosition: blockIndex,
      contentType: raw.contentType,
      metadata: inferMetadata(raw, wordCount),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  return atoms;
}

/**
 * Extract atoms from multiple blocks.
 */
export function extractAllAtoms(
  blocks: DetectedBlock[],
  options: AtomExtractionOptions,
): ContentAtom[] {
  return blocks.flatMap((block, i) => extractAtoms(block, i, options));
}

/** Walk the DOM tree and collect raw atom candidates. */
function collectRawAtoms(root: Element): RawAtom[] {
  const atoms: RawAtom[] = [];
  let currentHeading: string | null = null;

  walkForAtoms(root, atoms, { currentHeading });
  return atoms;
}

function walkForAtoms(
  el: Element,
  atoms: RawAtom[],
  ctx: { currentHeading: string | null },
): void {
  const tag = el.tagName.toLowerCase();

  // Skip non-content elements
  if (isSkippedTag(tag)) return;

  // Headings
  if (/^h[1-6]$/.test(tag)) {
    const text = getDirectText(el).trim();
    if (text.length > 0) {
      const contentType: ContentType = tag === 'h1' ? 'headline' : 'subheading';
      atoms.push({
        content: text,
        contentType,
        element: el,
        parentHeading: ctx.currentHeading,
      });
      ctx.currentHeading = text;
    }
    return;
  }

  // Paragraphs
  if (tag === 'p') {
    const text = (el.textContent ?? '').trim();
    if (text.length > 0) {
      atoms.push({
        content: text,
        contentType: 'body',
        element: el,
        parentHeading: ctx.currentHeading,
      });
    }
    return;
  }

  // List items
  if (tag === 'li') {
    const text = (el.textContent ?? '').trim();
    if (text.length > 0) {
      atoms.push({
        content: text,
        contentType: 'list-item',
        element: el,
        parentHeading: ctx.currentHeading,
      });
    }
    return;
  }

  // Images (alt text)
  if (tag === 'img') {
    const alt = el.getAttribute('alt')?.trim();
    if (alt && alt.length > 0) {
      atoms.push({
        content: alt,
        contentType: 'caption',
        element: el,
        parentHeading: ctx.currentHeading,
      });
    }
    return;
  }

  // CTA-like links and buttons
  if ((tag === 'a' || tag === 'button') && isCtaElement(el)) {
    const text = (el.textContent ?? '').trim();
    if (text.length > 0) {
      atoms.push({
        content: text,
        contentType: 'cta',
        element: el,
        parentHeading: ctx.currentHeading,
      });
    }
    return;
  }

  // Stat-like content (numbers with labels)
  if (isStatElement(el)) {
    const text = (el.textContent ?? '').trim();
    if (text.length > 0) {
      atoms.push({
        content: text,
        contentType: 'stat',
        element: el,
        parentHeading: ctx.currentHeading,
      });
    }
    return;
  }

  // Recurse into children
  for (let i = 0; i < el.children.length; i++) {
    walkForAtoms(el.children[i], atoms, ctx);
  }
}

function isSkippedTag(tag: string): boolean {
  return (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'link' ||
    tag === 'meta' ||
    tag === 'noscript' ||
    tag === 'svg' ||
    tag === 'iframe'
  );
}

function isCtaElement(el: Element): boolean {
  const classes = (el.className || '').toLowerCase();
  const role = el.getAttribute('role');
  const text = (el.textContent ?? '').toLowerCase().trim();

  return (
    classes.includes('btn') ||
    classes.includes('button') ||
    classes.includes('cta') ||
    role === 'button' ||
    /^(buy|shop|sign up|get started|learn more|subscribe|try|download|contact|register|join|start)/i.test(
      text,
    )
  );
}

function isStatElement(el: Element): boolean {
  const text = (el.textContent ?? '').trim();
  // Look for patterns like "100+", "5M", "$10B", "99%"
  return /^\d[\d,.]*[%+]?\s*[A-Za-z]*$/.test(text) && text.length < 20;
}

/** Get direct text content of an element (excluding children). */
function getDirectText(el: Element): string {
  const parts: string[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 3 /* TEXT_NODE */) {
      parts.push(node.textContent ?? '');
    }
  }
  return parts.join('');
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function generateAtomId(
  sourceUrl: string,
  blockIndex: number,
  atomIndex: number,
): string {
  // Simple deterministic ID from source URL + position
  const urlHash = simpleHash(sourceUrl);
  return `atom_${urlHash}_b${blockIndex}_a${atomIndex}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}

function inferMetadata(raw: RawAtom, wordCount: number): ContentMetadata {
  return {
    topics: [], // Populated later by embedder/profiler (task 1.5)
    audienceDepth: inferAudienceDepth(raw.content),
    purpose: inferPurpose(raw.contentType),
    emotionalRegister: 'rational',
    wordCount,
    language: 'en', // Could be detected via heuristics or Intl API
  };
}

function inferAudienceDepth(
  content: string,
): 'novice' | 'intermediate' | 'expert' {
  const words = content.toLowerCase();
  // Simple heuristic: technical jargon density
  const technicalIndicators = [
    'api',
    'sdk',
    'implementation',
    'architecture',
    'algorithm',
    'protocol',
    'infrastructure',
    'deployment',
    'configuration',
    'integration',
  ];
  const matches = technicalIndicators.filter((t) => words.includes(t)).length;

  if (matches >= 3) return 'expert';
  if (matches >= 1) return 'intermediate';
  return 'novice';
}

function inferPurpose(
  contentType: ContentType,
): 'inform' | 'persuade' | 'enable-action' | 'compare' | 'entertain' {
  switch (contentType) {
    case 'cta':
      return 'enable-action';
    case 'headline':
    case 'subheading':
      return 'inform';
    case 'stat':
      return 'persuade';
    default:
      return 'inform';
  }
}

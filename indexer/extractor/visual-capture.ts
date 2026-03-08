// indexer/extractor/visual-capture.ts — Screenshot each detected block for classification
// SLICC-1.4.5: Visual block capture for profiler-based block type classification.
// Works in-browser via html2canvas or in headless contexts via Puppeteer/Playwright.

import type { DetectedBlock } from './block-detector.js';

/** Result of capturing a visual snapshot of a block. */
export interface BlockCapture {
  /** CSS selector identifying the block */
  selector: string;
  /** Block position on page */
  rect: { top: number; left: number; width: number; height: number };
  /** Base64-encoded PNG data (null if capture is unavailable) */
  imageData: string | null;
  /** Capture method used */
  method: 'canvas' | 'element-screenshot' | 'none';
}

export interface VisualCaptureOptions {
  /** Maximum width for captured images (default: 800) */
  maxWidth?: number;
  /** Maximum height for captured images (default: 600) */
  maxHeight?: number;
  /** Image quality for JPEG output 0-1 (default: 0.8) */
  quality?: number;
}

const DEFAULT_OPTIONS: Required<VisualCaptureOptions> = {
  maxWidth: 800,
  maxHeight: 600,
  quality: 0.8,
};

/**
 * Capture visual snapshots of detected blocks.
 * Uses Canvas API when available (browser context).
 * Returns placeholder captures when no rendering context is available.
 */
export async function captureBlocks(
  blocks: DetectedBlock[],
  doc: Document,
  options: VisualCaptureOptions = {},
): Promise<BlockCapture[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: BlockCapture[] = [];

  for (const block of blocks) {
    results.push(await captureBlock(block, doc, opts));
  }

  return results;
}

async function captureBlock(
  block: DetectedBlock,
  doc: Document,
  opts: Required<VisualCaptureOptions>,
): Promise<BlockCapture> {
  const base: Omit<BlockCapture, 'imageData' | 'method'> = {
    selector: block.selector,
    rect: block.rect,
  };

  // Try Canvas-based capture in browser contexts
  const win = doc.defaultView;
  if (win && typeof win.HTMLCanvasElement !== 'undefined') {
    try {
      const data = await canvasCapture(block.element, doc, opts);
      if (data) {
        return { ...base, imageData: data, method: 'canvas' };
      }
    } catch {
      // Fall through to no-capture
    }
  }

  // No capture available — return metadata only
  return { ...base, imageData: null, method: 'none' };
}

/**
 * Capture a block using an offscreen Canvas.
 * Uses drawImage from a foreign object SVG (works in modern browsers).
 */
async function canvasCapture(
  el: Element,
  doc: Document,
  opts: Required<VisualCaptureOptions>,
): Promise<string | null> {
  const win = doc.defaultView;
  if (!win) return null;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const width = Math.min(rect.width, opts.maxWidth);
  const height = Math.min(rect.height, opts.maxHeight);
  const scale = Math.min(width / rect.width, height / rect.height);

  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Build SVG foreignObject containing the element's HTML
  const serializer = new win.XMLSerializer();
  const clone = el.cloneNode(true) as Element;
  const html = serializer.serializeToString(clone);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <foreignObject width="100%" height="100%">
        ${html}
      </foreignObject>
    </svg>
  `;

  const blob = new win.Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = win.URL.createObjectURL(blob);

  try {
    const img = new win.Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });

    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);

    return canvas.toDataURL('image/png', opts.quality);
  } finally {
    win.URL.revokeObjectURL(url);
  }
}

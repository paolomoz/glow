// core/blocks/assembler.ts — Produce final HTML from filled block templates
// Includes inline styles and AI provenance badge

import type { BlockTemplate } from '../types.js';
import type { FilledSlots } from './slot-filler.js';
import { DefaultSlotFiller } from './slot-filler.js';
import { wrapWithBadge } from './badge.js';

/**
 * Produces final HTML from a filled block template, including
 * inline styles and the AI provenance badge.
 */
export interface BlockAssembler {
  assemble(
    template: BlockTemplate,
    filledSlots: FilledSlots,
    cssRules: string
  ): string;
}

/**
 * Default block assembler. Fills slots, applies inline styles,
 * and wraps the result with an AI provenance badge.
 */
export class DefaultBlockAssembler implements BlockAssembler {
  private slotFiller = new DefaultSlotFiller();

  assemble(
    template: BlockTemplate,
    filledSlots: FilledSlots,
    cssRules: string,
  ): string {
    // Fill slot placeholders
    const filledHtml = this.slotFiller.fill(
      template.htmlShell,
      template.slots,
      filledSlots,
    );

    // Wrap with inline styles
    const styledHtml = wrapWithInlineStyles(filledHtml, cssRules);

    // Add AI provenance badge
    return wrapWithBadge(styledHtml);
  }
}

/**
 * Wrap HTML with a container that carries inline styles.
 * Uses inline styles derived from extracted computed CSS.
 */
function wrapWithInlineStyles(html: string, cssRules: string): string {
  if (!cssRules || cssRules.trim().length === 0) {
    return html;
  }

  return `<div data-glow-block style="${escapeCssForAttribute(cssRules)}">${html}</div>`;
}

/** Escape CSS for use in a style attribute. */
function escapeCssForAttribute(css: string): string {
  // Remove comments and normalize whitespace
  return css
    .replace(/\/\*[^*]*\*\//g, '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

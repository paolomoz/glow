/**
 * AI provenance badge markup for injected blocks.
 * Shows the ✦ icon in the top-right corner indicating generated content.
 */
export const AI_BADGE_HTML = `<span class="glow-ai-badge" style="position:absolute;top:4px;right:4px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);color:#fff;border-radius:50%;font-size:12px;cursor:pointer;z-index:9999;" title="AI-generated content">✦</span>`;

export function wrapWithBadge(blockHtml: string): string {
  return `<div style="position:relative;">${blockHtml}${AI_BADGE_HTML}</div>`;
}

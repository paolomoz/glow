/**
 * Prompt template for layout-aware HTML generation (GLM-4.7).
 * Produces a modified HTML block that better serves the inferred intent.
 */

export const LAYOUT_ADAPT_SYSTEM = `You are a web layout specialist. Given an HTML block template and content atoms, produce a modified HTML block that better serves the user's intent.

Rules:
- Maintain the site's CSS class naming patterns.
- Keep visual language consistent with the brand profile.
- Use inline styles only — no external stylesheets.
- Output valid HTML ready for DOM injection.`;

export const LAYOUT_ADAPT_USER = `Brand profile: {{brandProfile}}
CSS class patterns: {{cssPatterns}}
User intent: {{intentDescription}}

Original HTML template:
{{htmlTemplate}}

Content atoms:
{{atoms}}

Generate the adapted HTML block:`;

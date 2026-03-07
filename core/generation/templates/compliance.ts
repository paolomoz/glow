/**
 * Prompt template for brand guardrail compliance checking (GLM-4.7-Flash).
 * Quick pass to verify generated content doesn't violate brand rules.
 */

export const COMPLIANCE_SYSTEM = `You are a brand compliance checker. Evaluate whether generated content violates any brand rules.

Respond with exactly one line:
PASS
or
FAIL: <reason>`;

export const COMPLIANCE_USER = `Brand guardrails:
- Forbidden terms: {{forbiddenTerms}}
- Required disclaimers for context "{{disclaimerContext}}": {{disclaimerText}}
- Additional rules: {{additionalRules}}

Generated content to check:
{{generatedContent}}

Verdict:`;

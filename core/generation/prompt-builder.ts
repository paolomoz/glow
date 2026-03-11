// core/generation/prompt-builder.ts — Assemble generation prompts
// CC-2.3.3: Build prompts from brand brief + intent + template + atoms
// Total must stay under MAX_INPUT_TOKENS (2000) for speed

import type {
  BrandProfile,
  ContentAtom,
  IntentVector,
  SlotDefinition,
  GenerationTask,
} from '../types.js';
import { MAX_INPUT_TOKENS } from '../types.js';

export interface PromptComponents {
  systemPrompt: string;
  userPrompt: string;
  estimatedTokens: number;
}

/**
 * Assembles generation prompts from brand brief + intent + template + atoms.
 * Total prompt must stay under MAX_INPUT_TOKENS (2000) for speed.
 */
export interface PromptBuilder {
  build(
    task: GenerationTask,
    atoms: ContentAtom[],
    slots: SlotDefinition[],
    intent: IntentVector,
    brand: BrandProfile
  ): PromptComponents;
}

const CHARS_PER_TOKEN = 4;

/**
 * Default prompt builder. Constructs system + user prompts for each
 * generation task type, staying within the token budget.
 */
export class DefaultPromptBuilder implements PromptBuilder {
  build(
    task: GenerationTask,
    atoms: ContentAtom[],
    slots: SlotDefinition[],
    intent: IntentVector,
    brand: BrandProfile,
  ): PromptComponents {
    const systemPrompt = this.buildSystemPrompt(task, brand);
    const userPrompt = this.buildUserPrompt(task, atoms, slots, intent);

    // Estimate total tokens
    const totalChars = systemPrompt.length + userPrompt.length;
    const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);

    // If over budget, trim atom content
    if (estimatedTokens > MAX_INPUT_TOKENS) {
      const trimmedUser = this.trimToFit(
        userPrompt,
        MAX_INPUT_TOKENS * CHARS_PER_TOKEN - systemPrompt.length,
      );
      return {
        systemPrompt,
        userPrompt: trimmedUser,
        estimatedTokens: MAX_INPUT_TOKENS,
      };
    }

    return { systemPrompt, userPrompt, estimatedTokens };
  }

  private buildSystemPrompt(
    task: GenerationTask,
    brand: BrandProfile,
  ): string {
    const brandBrief = [
      `Voice: ${brand.voice.tone.join(', ')}`,
      `Formality: ${brand.voice.formality}`,
      `Perspective: ${brand.voice.personPerspective} person`,
      brand.voice.characteristicPhrases.length > 0
        ? `Characteristic phrases: ${brand.voice.characteristicPhrases.join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('. ');

    const guardrails: string[] = [];
    if (brand.guardrails.forbiddenTerms.length > 0) {
      guardrails.push(
        `FORBIDDEN terms: ${brand.guardrails.forbiddenTerms.join(', ')}`,
      );
    }
    for (const d of brand.guardrails.requiredDisclaimers) {
      guardrails.push(`When ${d.context}: include "${d.text}"`);
    }

    const taskInstruction = TASK_SYSTEM_INSTRUCTIONS[task];

    return [
      taskInstruction,
      '',
      `Brand: ${brandBrief}`,
      guardrails.length > 0 ? `\nConstraints:\n${guardrails.join('\n')}` : '',
      '\nDo not invent facts not present in the source atoms.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildUserPrompt(
    task: GenerationTask,
    atoms: ContentAtom[],
    slots: SlotDefinition[],
    intent: IntentVector,
  ): string {
    const intentDesc = describeIntent(intent);
    const atomSection = formatAtoms(atoms);
    const slotSection = formatSlots(slots);

    switch (task) {
      case 'content_fill':
        return [
          `## User Intent\n${intentDesc}`,
          `\n## Source Content\n${atomSection}`,
          `\n## Slots to Fill\n${slotSection}`,
          '\nFill each slot using the source content, adapted for the user intent.',
          'Respond with JSON: {"slotName": "value", ...}',
        ].join('\n');

      case 'layout_adapt':
        return [
          `## User Intent\n${intentDesc}`,
          `\n## Source Content\n${atomSection}`,
          `\n## Template Slots\n${slotSection}`,
          '\nProduce an HTML block that serves the user intent.',
          'Use inline styles. Maintain visual consistency with the brand.',
        ].join('\n');

      case 'atom_select':
        return [
          `## User Intent\n${intentDesc}`,
          `\n## Available Content\n${atomSection}`,
          `\n## Slots Required\n${slotSection}`,
          '\nSelect the best atoms for each slot.',
          'Respond with JSON: {"slotName": "atomId", ...}',
        ].join('\n');

      case 'compliance_check':
        return [
          `## Generated Content to Review\n${atomSection}`,
          `\n## Check Against\n- Brand guardrails\n- Factual accuracy\n- Tone consistency`,
          '\nRespond with JSON: {"pass": true/false, "issues": ["issue1", ...]}',
        ].join('\n');

      default:
        return `## Content\n${atomSection}\n\n## Slots\n${slotSection}`;
    }
  }

  private trimToFit(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 20) + '\n\n[Content truncated]';
  }
}

// ---------------------------------------------------------------------------
// Task-specific system instructions
// ---------------------------------------------------------------------------

const TASK_SYSTEM_INSTRUCTIONS: Record<GenerationTask, string> = {
  content_fill:
    'You are a content personalization engine. Fill template slots using provided content atoms, adapted for the user\'s intent and the brand voice. Output valid JSON with slot names as keys.',
  layout_adapt:
    'You are a layout-aware HTML generator. Produce modified HTML blocks that serve the user\'s intent while maintaining visual consistency. Use inline styles only — no external stylesheets.',
  atom_select:
    'You are a content selector. Choose the most relevant content atoms for each template slot based on user intent. Output valid JSON mapping slot names to atom IDs.',
  compliance_check:
    'You are a brand compliance checker. Review generated content against brand guardrails, factual accuracy, and tone consistency. Output valid JSON with pass/fail and any issues.',
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function describeIntent(intent: IntentVector): string {
  const lines = [
    `Archetype: ${intent.archetype} (confidence: ${intent.confidence.toFixed(2)})`,
    `Content depth: ${intent.contentDepth}`,
    `Audience: ${intent.audienceMode}`,
    `Emotional register: ${intent.emotionalRegister}`,
    `Signals processed: ${intent.signalCount}`,
  ];
  if (intent.topics.length > 0) {
    lines.push(`User interests: ${intent.topics.slice(0, 15).join(', ')}`);
  }
  return lines.join('\n');
}

function formatAtoms(atoms: ContentAtom[]): string {
  return atoms
    .map(
      (a) =>
        `[${a.id}] (${a.contentType}) ${a.content.slice(0, 300)}`,
    )
    .join('\n');
}

function formatSlots(slots: SlotDefinition[]): string {
  return slots
    .map(
      (s) => {
        let desc = `- ${s.name} (${s.type}): ${s.constraints.required ? 'required' : 'optional'}, ` +
          `${s.constraints.minLength ?? 0}-${s.constraints.maxLength ?? '∞'} chars`;
        if (s.type === 'image') {
          desc += `. Value must be an image URL from the source atoms.`;
        }
        return desc;
      },
    )
    .join('\n');
}

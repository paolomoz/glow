// core/blocks/registry.ts — Store and retrieve block templates
// CC-2.2.3: Template selection by position and content type matching

import type { BlockTemplate, BlockPosition } from '../types.js';

/**
 * Stores and retrieves block templates for a site.
 */
export interface BlockRegistry {
  register(template: BlockTemplate): void;
  get(templateId: string): BlockTemplate | undefined;
  getByPosition(position: BlockPosition): BlockTemplate[];
  getAll(): BlockTemplate[];
}

/**
 * In-memory block template registry.
 */
export class DefaultBlockRegistry implements BlockRegistry {
  private templates = new Map<string, BlockTemplate>();
  private byPosition = new Map<BlockPosition, BlockTemplate[]>();

  register(template: BlockTemplate): void {
    this.templates.set(template.id, template);

    const positionList = this.byPosition.get(template.position) ?? [];
    positionList.push(template);
    this.byPosition.set(template.position, positionList);
  }

  get(templateId: string): BlockTemplate | undefined {
    return this.templates.get(templateId);
  }

  getByPosition(position: BlockPosition): BlockTemplate[] {
    return this.byPosition.get(position) ?? [];
  }

  getAll(): BlockTemplate[] {
    return Array.from(this.templates.values());
  }

  /** Load templates in bulk (e.g. from a content index). */
  loadAll(templates: BlockTemplate[]): void {
    for (const t of templates) {
      this.register(t);
    }
  }

  /** Clear all registered templates. */
  clear(): void {
    this.templates.clear();
    this.byPosition.clear();
  }
}

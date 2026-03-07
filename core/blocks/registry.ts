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

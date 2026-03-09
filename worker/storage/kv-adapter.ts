// worker/storage/kv-adapter.ts — KV-backed storage adapter
// CC-4.1.3: Implements core StorageInterface using Cloudflare KV

import type {
  StorageInterface,
  ContentAtom,
  ContentMetadata,
  BlockTemplate,
  BlockPosition,
  BrandProfile,
  AnalyticsEvent,
} from '@glow/core';
import { SPECULATIVE_CACHE_TTL_SECONDS } from '@glow/core';

/**
 * Key schema:
 *   template:{siteId}:{templateId}    → BlockTemplate JSON
 *   templates:{siteId}:{position}     → templateId[] JSON
 *   profile:{siteId}                  → BrandProfile JSON
 *   cache:{key}                       → cached HTML string
 *   atoms:{siteId}                    → ContentAtom[] JSON (for small sites)
 */
export class KVStorageAdapter implements StorageInterface {
  constructor(
    private blocksKV: KVNamespace,
    private cacheKV: KVNamespace,
  ) {}

  // -------------------------------------------------------------------------
  // Atom retrieval (stored in KV for demo; Vectorize for production)
  // -------------------------------------------------------------------------

  async queryAtoms(
    siteId: string,
    _embedding: number[],
    _filters: Partial<ContentMetadata>,
    limit: number,
  ): Promise<ContentAtom[]> {
    const raw = await this.blocksKV.get(`atoms:${siteId}`, { type: 'json' });
    if (!raw) return [];
    const atoms = raw as ContentAtom[];
    return atoms.slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Template retrieval
  // -------------------------------------------------------------------------

  async getTemplate(
    siteId: string,
    templateId: string,
  ): Promise<BlockTemplate | null> {
    const raw = await this.blocksKV.get(
      `template:${siteId}:${templateId}`,
      { type: 'json' },
    );
    return (raw as BlockTemplate) ?? null;
  }

  async getTemplatesForPosition(
    siteId: string,
    position: BlockPosition,
  ): Promise<BlockTemplate[]> {
    const idsRaw = await this.blocksKV.get(
      `templates:${siteId}:${position}`,
      { type: 'json' },
    );
    if (!idsRaw) return [];

    const ids = idsRaw as string[];
    const templates = await Promise.all(
      ids.map((id) => this.getTemplate(siteId, id)),
    );
    return templates.filter((t): t is BlockTemplate => t !== null);
  }

  // -------------------------------------------------------------------------
  // Brand profile
  // -------------------------------------------------------------------------

  async getBrandProfile(siteId: string): Promise<BrandProfile | null> {
    const raw = await this.blocksKV.get(`profile:${siteId}`, {
      type: 'json',
    });
    return (raw as BrandProfile) ?? null;
  }

  // -------------------------------------------------------------------------
  // Cache
  // -------------------------------------------------------------------------

  async getCachedBlock(key: string): Promise<string | null> {
    return this.cacheKV.get(`cache:${key}`);
  }

  async setCachedBlock(
    key: string,
    html: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.cacheKV.put(`cache:${key}`, html, {
      expirationTtl: ttlSeconds,
    });
  }

  // -------------------------------------------------------------------------
  // Analytics (fire-and-forget to KV; R2 handles bulk)
  // -------------------------------------------------------------------------

  async logEvent(event: AnalyticsEvent): Promise<void> {
    const key = `event:${event.sessionId}:${Date.now()}`;
    await this.cacheKV.put(key, JSON.stringify(event), {
      expirationTtl: 3600, // 1 hour TTL for event buffer
    });
  }

  // -------------------------------------------------------------------------
  // Bulk write operations (for indexing)
  // -------------------------------------------------------------------------

  async storeAtoms(siteId: string, atoms: ContentAtom[]): Promise<void> {
    await this.blocksKV.put(`atoms:${siteId}`, JSON.stringify(atoms));
  }

  async storeTemplate(
    siteId: string,
    template: BlockTemplate,
  ): Promise<void> {
    await this.blocksKV.put(
      `template:${siteId}:${template.id}`,
      JSON.stringify(template),
    );

    // Update position index
    const posKey = `templates:${siteId}:${template.position}`;
    const existing = (await this.blocksKV.get(posKey, { type: 'json' })) as
      | string[]
      | null;
    const ids = existing ?? [];
    if (!ids.includes(template.id)) {
      ids.push(template.id);
      await this.blocksKV.put(posKey, JSON.stringify(ids));
    }
  }

  async storeBrandProfile(profile: BrandProfile): Promise<void> {
    await this.blocksKV.put(
      `profile:${profile.siteId}`,
      JSON.stringify(profile),
    );
  }
}

// KV type (mirrors env.ts)
interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

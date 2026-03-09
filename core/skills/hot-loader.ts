// core/skills/hot-loader.ts — Skill hot-loading from external sources
// CC-5.7: Load skill configs from KV or JSON files without redeployment

import type { SkillConfig } from '../types.js';
import { validateSkillConfig } from './validator.js';
import { loadDefaultSkillConfig } from './loader.js';

/**
 * Loads skill configs with hot-loading support.
 * Priority: external source (KV/fetch) → built-in defaults → generic fallback.
 */
export class SkillHotLoader {
  private cache = new Map<string, { config: SkillConfig; loadedAt: number }>();
  private cacheTtlMs: number;
  private externalLoader: ExternalSkillLoader | null;

  constructor(options?: {
    cacheTtlMs?: number;
    externalLoader?: ExternalSkillLoader;
  }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 5 * 60 * 1000; // 5 min default
    this.externalLoader = options?.externalLoader ?? null;
  }

  /**
   * Load a skill config by site type.
   * Checks cache → external source → built-in defaults.
   */
  async load(siteType: string): Promise<SkillConfig> {
    // 1. Check cache
    const cached = this.cache.get(siteType);
    if (cached && Date.now() - cached.loadedAt < this.cacheTtlMs) {
      return cached.config;
    }

    // 2. Try external source
    if (this.externalLoader) {
      try {
        const external = await this.externalLoader.load(siteType);
        if (external) {
          const validation = validateSkillConfig(external);
          if (validation.valid) {
            this.cache.set(siteType, {
              config: external as SkillConfig,
              loadedAt: Date.now(),
            });
            return external as SkillConfig;
          }
          // Invalid config — log and fall through to defaults
        }
      } catch {
        // External load failed — fall through
      }
    }

    // 3. Built-in defaults
    const builtin = loadDefaultSkillConfig(siteType);
    if (builtin) {
      this.cache.set(siteType, { config: builtin, loadedAt: Date.now() });
      return builtin;
    }

    // 4. Generic fallback
    const generic = loadDefaultSkillConfig('generic')!;
    this.cache.set(siteType, { config: generic, loadedAt: Date.now() });
    return generic;
  }

  /**
   * Invalidate cached config for a site type.
   * Forces reload on next access.
   */
  invalidate(siteType: string): void {
    this.cache.delete(siteType);
  }

  /**
   * Clear all cached configs.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Manually set a config (useful for testing or runtime overrides).
   */
  setConfig(siteType: string, config: SkillConfig): void {
    this.cache.set(siteType, { config, loadedAt: Date.now() });
  }
}

/**
 * Interface for external skill config sources (KV, HTTP, etc.).
 */
export interface ExternalSkillLoader {
  load(siteType: string): Promise<SkillConfig | null>;
}

/**
 * KV-based external loader for Cloudflare Workers.
 */
export class KVSkillLoader implements ExternalSkillLoader {
  private kv: { get(key: string, opts?: { type?: string }): Promise<unknown> };

  constructor(kv: { get(key: string, opts?: { type?: string }): Promise<unknown> }) {
    this.kv = kv;
  }

  async load(siteType: string): Promise<SkillConfig | null> {
    const raw = await this.kv.get(`skill:${siteType}`, { type: 'json' });
    return (raw as SkillConfig) ?? null;
  }
}

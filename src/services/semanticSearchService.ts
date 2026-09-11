import { env } from '../config/env.js';
import type { OdooClient } from '../clients/odooClient.js';
import type { AllowedModel } from '../security/whitelist.js';
import { combineDomainsAnd, type OdooDomain } from '../utils/domainBuilder.js';
import type { NormalizedResult } from '../mappers/types.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import type { VectorStore } from '../embeddings/vectorStore.js';
import { cosineSimilarity } from '../embeddings/cosine.js';

export type CacheState = 'missing' | 'stale' | 'fresh';

export interface CacheStatus {
  state: CacheState;
  indexedCount: number;
  lastCheckpointWriteDate: string | null;
  lastFullReconcileAt: string | null;
}

export interface SemanticSearchOptions {
  limit: number;
  filterDomain: OdooDomain;
  fields: string[];
}

export interface SemanticSearchResult {
  results: NormalizedResult[];
  cacheStatus: CacheStatus;
  hasMore: boolean;
}

function computeCacheState(store: VectorStore): CacheState {
  const { count, lastCheckpointWriteDate, lastFullReconcileAt } = store.meta;
  if (count === 0) return 'missing';
  const timestamps = [lastCheckpointWriteDate, lastFullReconcileAt]
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime());
  if (timestamps.length === 0) return 'stale';
  const mostRecent = Math.max(...timestamps);
  return Date.now() - mostRecent > env.EMBEDDING_CACHE_STALE_AFTER_MS ? 'stale' : 'fresh';
}

/**
 * Recherche par similarité cosinus sur le cache vectoriel local (voir `npm run
 * reindex`). Ne déclenche jamais de scan Odoo complet : lit uniquement le cache
 * déjà construit, puis re-fetch les champs à jour via `search_read` pour les
 * seuls ids retenus (même méthode whitelistée, domain `id in [...]`).
 */
export async function searchSemantic(
  client: OdooClient,
  model: AllowedModel,
  query: string,
  opts: SemanticSearchOptions,
  provider: EmbeddingProvider,
  store: VectorStore,
  mapRow: (raw: Record<string, unknown>) => NormalizedResult,
): Promise<SemanticSearchResult> {
  const cacheStatus: CacheStatus = {
    state: computeCacheState(store),
    indexedCount: store.meta.count,
    lastCheckpointWriteDate: store.meta.lastCheckpointWriteDate,
    lastFullReconcileAt: store.meta.lastFullReconcileAt,
  };

  if (cacheStatus.state === 'missing') {
    return { results: [], cacheStatus, hasMore: false };
  }

  const [queryVector] = await provider.embed([query]);
  if (!queryVector) {
    return { results: [], cacheStatus, hasMore: false };
  }
  const scored = store
    .allVectors()
    .map(({ id, vector }) => ({ id, score: cosineSimilarity(queryVector, vector) }))
    .filter((entry) => entry.score >= env.SEMANTIC_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, env.SEMANTIC_TOP_K);

  if (scored.length === 0) {
    return { results: [], cacheStatus, hasMore: false };
  }

  const ids = scored.map((entry) => entry.id);
  const domain = combineDomainsAnd([['id', 'in', ids]], opts.filterDomain);
  const rows = await client.searchRead({
    model,
    method: 'search_read',
    domain,
    fields: opts.fields,
    limit: ids.length,
  });

  const scoreById = new Map(scored.map((entry) => [entry.id, entry.score]));
  const cacheLabel = cacheStatus.lastCheckpointWriteDate ?? cacheStatus.lastFullReconcileAt ?? 'inconnu';
  const results = rows
    .map((raw) => {
      const mapped = mapRow(raw);
      const score = scoreById.get(mapped.id) ?? 0;
      return {
        ...mapped,
        relevanceScore: score,
        relevanceReason: `similarité sémantique cosinus: ${score.toFixed(2)} (cache du ${cacheLabel})`,
      };
    })
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, opts.limit);

  return { results, cacheStatus, hasMore: scored.length > opts.limit };
}

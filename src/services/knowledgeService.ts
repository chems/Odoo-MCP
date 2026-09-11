import { env } from '../config/env.js';
import type { OdooClient } from '../clients/odooClient.js';
import {
  buildFilterDomain,
  buildMultiTermTextSearchDomain,
  combineDomainsAnd,
  type OdooDomain,
} from '../utils/domainBuilder.js';
import { filterAllowedFields } from '../security/whitelist.js';
import { mapKnowledgeArticleToNormalized } from '../mappers/knowledgeMapper.js';
import type { NormalizedResult } from '../mappers/types.js';
import type { SearchKnowledgeParams } from '../schemas/knowledge.js';
import { scoreLexicalRelevance } from '../scoring/lexicalScore.js';
import { searchSemantic, type SemanticSearchResult } from './semanticSearchService.js';
import { mergeHybridResults } from './hybridMerge.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import type { VectorStore } from '../embeddings/vectorStore.js';

const TEXT_SEARCH_FIELDS = ['name', 'body'] as const;

export interface KnowledgeSearchResult {
  results: NormalizedResult[];
  ignoredFields: string[];
  hasMore: boolean;
  modeLimitations: string[];
}

export interface SemanticDeps {
  provider: EmbeddingProvider;
  store: VectorStore;
}

function buildFilterDomainForParams(params: SearchKnowledgeParams): OdooDomain {
  return buildFilterDomain({
    parent_id: params.parentId,
    is_published: params.isPublished,
    is_locked: params.isLocked,
  });
}

async function searchLexical(
  client: OdooClient,
  params: SearchKnowledgeParams,
): Promise<{ results: NormalizedResult[]; ignoredFields: string[]; hasMore: boolean }> {
  const textDomain = buildMultiTermTextSearchDomain(TEXT_SEARCH_FIELDS, params.query);
  const filterDomain = buildFilterDomainForParams(params);
  const domain = combineDomainsAnd(textDomain, filterDomain);

  const { fields, ignoredFields } = filterAllowedFields('knowledge.article', params.fields);
  const limit = Math.min(params.limit, env.MCP_MAX_RESULTS_PER_QUERY);

  const rows = await client.searchRead({
    model: 'knowledge.article',
    method: 'search_read',
    domain,
    fields,
    limit,
    offset: params.offset,
  });

  const results = rows
    .map(mapKnowledgeArticleToNormalized)
    .map((result) => {
      const score = scoreLexicalRelevance(params.query, result.title, result.content);
      return { ...result, relevanceScore: score.value, relevanceReason: score.reason };
    })
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));

  return { results, ignoredFields, hasMore: rows.length === limit };
}

export async function searchKnowledgeArticles(
  client: OdooClient,
  params: SearchKnowledgeParams,
  semanticDeps?: SemanticDeps,
): Promise<KnowledgeSearchResult> {
  const lexical = await searchLexical(client, params);

  if (params.mode === 'text') {
    return { ...lexical, modeLimitations: [] };
  }

  if (!semanticDeps) {
    return {
      ...lexical,
      modeLimitations: [
        "mode sémantique/hybride demandé mais aucun fournisseur d'embeddings configuré — résultats en mode texte uniquement",
      ],
    };
  }

  const { fields } = filterAllowedFields('knowledge.article', params.fields);
  const limit = Math.min(params.limit, env.MCP_MAX_RESULTS_PER_QUERY);
  const semantic: SemanticSearchResult = await searchSemantic(
    client,
    'knowledge.article',
    params.query,
    { limit, filterDomain: buildFilterDomainForParams(params), fields },
    semanticDeps.provider,
    semanticDeps.store,
    mapKnowledgeArticleToNormalized,
  );

  const modeLimitations: string[] = [];
  if (semantic.cacheStatus.state === 'missing') {
    modeLimitations.push(
      "cache sémantique introuvable — exécutez 'npm run reindex'; résultats en mode texte uniquement",
    );
  } else if (semantic.cacheStatus.state === 'stale') {
    modeLimitations.push("cache sémantique périmé — exécutez 'npm run reindex' pour le rafraîchir");
  }

  if (params.mode === 'semantic') {
    if (semantic.cacheStatus.state === 'missing') {
      return { ...lexical, modeLimitations };
    }
    return { results: semantic.results, ignoredFields: lexical.ignoredFields, hasMore: semantic.hasMore, modeLimitations };
  }

  const merged = mergeHybridResults(
    lexical.results,
    semantic.results,
    { lexical: env.HYBRID_LEXICAL_WEIGHT, semantic: env.HYBRID_SEMANTIC_WEIGHT },
    limit,
  );
  return {
    results: merged,
    ignoredFields: lexical.ignoredFields,
    hasMore: lexical.hasMore || semantic.hasMore,
    modeLimitations,
  };
}

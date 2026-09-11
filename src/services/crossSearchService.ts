import { env } from '../config/env.js';
import type { OdooClient } from '../clients/odooClient.js';
import { normalizeAndTokenize, extractReferenceCandidates } from '../utils/tokenize.js';
import { toMcpToolError } from '../security/errors.js';
import { searchKnowledgeArticles } from './knowledgeService.js';
import { searchHelpdeskTickets } from './helpdeskService.js';
import { DEFAULT_HELPDESK_ORDER } from '../utils/order.js';
import type { NormalizedResult, RelatedResultRef } from '../mappers/types.js';
import type { SearchAllParams } from '../schemas/searchAll.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import type { VectorStore } from '../embeddings/vectorStore.js';

export interface SearchAllSemanticDeps {
  provider: EmbeddingProvider;
  knowledgeStore: VectorStore;
  helpdeskStore: VectorStore;
}

const RELATION_MAX_PER_ITEM = 3;
const REFERENCE_BONUS = 0.2;

export const CROSS_SEARCH_LIMITATIONS = [
  "Aucun champ de rattachement structurel confirmé entre knowledge.article et helpdesk.ticket (pas de tags/catégorie/produit/client partagé confirmé dans les données observées).",
  'Le rapprochement est purement lexical (recouvrement de mots-clés normalisés), pas sémantique : deux textes traitant du même sujet avec un vocabulaire différent ne seront pas rapprochés. Aucun embedding/recherche vectorielle n\'est utilisé.',
  "Aucune donnée de comptage total disponible (search_count hors périmètre) : le nombre de résultats retournés n'est pas le total réel côté Odoo.",
] as const;

export interface SearchAllError {
  source: 'knowledge' | 'helpdesk';
  error: string;
}

export interface SearchAllResult {
  results: NormalizedResult[];
  errors: SearchAllError[];
  crossSearchLimitations: readonly string[];
  modeLimitations: string[];
}

interface Tokenized {
  result: NormalizedResult;
  tokens: Set<string>;
  refs: Set<string>;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersectionSize = 0;
  for (const token of a) {
    if (b.has(token)) intersectionSize += 1;
  }
  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function topCommonTokens(a: Set<string>, b: Set<string>, max = 5): string[] {
  const common = [...a].filter((token) => b.has(token));
  return common.sort((x, y) => y.length - x.length || x.localeCompare(y)).slice(0, max);
}

function hasCommonReference(a: Set<string>, b: Set<string>): boolean {
  for (const ref of a) {
    if (b.has(ref)) return true;
  }
  return false;
}

/**
 * Calcule, pour chaque article/ticket, les meilleures relations lexicales avec
 * l'autre source (recouvrement de tokens normalisés, type Jaccard, + bonus si
 * référence numérique commune détectée). Complexité O(articles × tickets),
 * bornée par MCP_MAX_RESULTS_PER_QUERY des deux côtés.
 */
export function detectRelations(articles: NormalizedResult[], tickets: NormalizedResult[]): void {
  const tokenizedArticles: Tokenized[] = articles.map((result) => ({
    result,
    tokens: normalizeAndTokenize(`${result.title} ${result.content ?? ''}`),
    refs: extractReferenceCandidates(`${result.title} ${result.content ?? ''}`),
  }));
  const tokenizedTickets: Tokenized[] = tickets.map((result) => ({
    result,
    tokens: normalizeAndTokenize(`${result.title} ${result.content ?? ''}`),
    refs: extractReferenceCandidates(`${result.title} ${result.content ?? ''}`),
  }));

  for (const article of tokenizedArticles) {
    const candidates: RelatedResultRef[] = [];
    for (const ticket of tokenizedTickets) {
      const score = scorePair(article, ticket);
      if (score === null) continue;
      candidates.push({
        source: 'helpdesk',
        id: ticket.result.id,
        title: ticket.result.title,
        relevanceScore: score.value,
        reason: score.reason,
      });
    }
    article.result.relatedResults = topN(candidates, RELATION_MAX_PER_ITEM);
  }

  for (const ticket of tokenizedTickets) {
    const candidates: RelatedResultRef[] = [];
    for (const article of tokenizedArticles) {
      const score = scorePair(ticket, article);
      if (score === null) continue;
      candidates.push({
        source: 'knowledge',
        id: article.result.id,
        title: article.result.title,
        relevanceScore: score.value,
        reason: score.reason,
      });
    }
    ticket.result.relatedResults = topN(candidates, RELATION_MAX_PER_ITEM);
  }
}

function scorePair(a: Tokenized, b: Tokenized): { value: number; reason: string } | null {
  const base = jaccard(a.tokens, b.tokens);
  const commonRef = hasCommonReference(a.refs, b.refs);
  const value = Math.min(base + (commonRef ? REFERENCE_BONUS : 0), 1);
  if (value < env.CROSS_SEARCH_MIN_SCORE) {
    return null;
  }
  const commonTokens = topCommonTokens(a.tokens, b.tokens);
  const reasonParts: string[] = [];
  if (commonTokens.length > 0) {
    reasonParts.push(`${commonTokens.length} mot(s)-clé(s) commun(s): ${commonTokens.join(', ')}`);
  }
  if (commonRef) {
    reasonParts.push('référence numérique commune détectée');
  }
  return { value, reason: reasonParts.join(' ; ') || 'similarité lexicale faible' };
}

function topN(candidates: RelatedResultRef[], n: number): RelatedResultRef[] {
  return [...candidates].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, n);
}

export async function searchAll(
  client: OdooClient,
  params: SearchAllParams,
  semanticDeps?: SearchAllSemanticDeps,
): Promise<SearchAllResult> {
  const [knowledgeSettled, helpdeskSettled] = await Promise.allSettled([
    searchKnowledgeArticles(
      client,
      { query: params.query, limit: params.limit, offset: 0, mode: params.mode },
      semanticDeps && { provider: semanticDeps.provider, store: semanticDeps.knowledgeStore },
    ),
    searchHelpdeskTickets(
      client,
      {
        query: params.query,
        limit: params.limit,
        offset: 0,
        mode: params.mode,
        order: DEFAULT_HELPDESK_ORDER,
        // `search_all` sert à repérer des rapprochements, pas à lire des fils :
        // le contenu des messages y serait du poids mort.
        includeMessages: false,
        messageLimit: 10,
      },
      semanticDeps && { provider: semanticDeps.provider, store: semanticDeps.helpdeskStore },
    ),
  ]);

  const errors: SearchAllError[] = [];
  const modeLimitations: string[] = [];
  const articles = knowledgeSettled.status === 'fulfilled' ? knowledgeSettled.value.results : [];
  const tickets = helpdeskSettled.status === 'fulfilled' ? helpdeskSettled.value.results : [];

  if (knowledgeSettled.status === 'rejected') {
    errors.push({ source: 'knowledge', error: toMcpToolError(knowledgeSettled.reason).message });
  } else {
    modeLimitations.push(...knowledgeSettled.value.modeLimitations);
  }
  if (helpdeskSettled.status === 'rejected') {
    errors.push({ source: 'helpdesk', error: toMcpToolError(helpdeskSettled.reason).message });
  } else {
    modeLimitations.push(...helpdeskSettled.value.modeLimitations);
  }

  if (params.includeRelations && articles.length > 0 && tickets.length > 0) {
    detectRelations(articles, tickets);
  }

  return {
    results: [...articles, ...tickets],
    errors,
    crossSearchLimitations: CROSS_SEARCH_LIMITATIONS,
    modeLimitations: [...new Set(modeLimitations)],
  };
}

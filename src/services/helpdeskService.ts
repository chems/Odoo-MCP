import { env } from '../config/env.js';
import type { OdooClient } from '../clients/odooClient.js';
import {
  buildFilterDomain,
  buildMultiTermTextSearchDomain,
  combineDomainsAnd,
  type OdooDomain,
} from '../utils/domainBuilder.js';
import { filterAllowedFields, withBaseFields } from '../security/whitelist.js';
import type { IgnoredField } from '../security/whitelist.js';
import { mapHelpdeskTicketToNormalized } from '../mappers/helpdeskMapper.js';
import type { NormalizedResult, TicketMessageSummary } from '../mappers/types.js';
import type { GetHelpdeskTicketMessagesParams, SearchHelpdeskParams } from '../schemas/helpdesk.js';
import { scoreLexicalRelevance } from '../scoring/lexicalScore.js';
import { searchSemantic, type SemanticSearchResult } from './semanticSearchService.js';
import { mergeHybridResults } from './hybridMerge.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import type { VectorStore } from '../embeddings/vectorStore.js';
import { extractMany2OneLabel, odooDatetimeToIso } from '../mappers/common.js';
import { buildOrderClause } from '../utils/order.js';
import { buildDateRangeDomain, resolveDateRange, type ResolvedRange } from '../utils/dateRange.js';

function stripHtml(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TEXT_SEARCH_FIELDS = ['name', 'description'] as const;

/**
 * Champs toujours demandés à Odoo, quels que soient les `fields` reçus : sans ce
 * socle, `fields: ["id"]` produisait une sortie sans équipe, sans produit et sans
 * étiquette, donnant à croire que la donnée n'existait pas.
 */
const HELPDESK_BASE_FIELDS = [
  'id',
  'name',
  'create_date',
  'write_date',
  'stage_id',
  'team_id',
  'tag_ids',
  'priority',
  'x_studio_produit',
  'access_url',
] as const;

/** Nombre d'appels `mail.message` menés de front quand `includeMessages` est vrai. */
const MESSAGE_FETCH_CONCURRENCY = 5;

export interface HelpdeskSearchResult {
  results: NormalizedResult[];
  ignoredFields: string[];
  ignoredFieldsDetail: IgnoredField[];
  /** Taille de la page renvoyée. */
  count: number;
  /** Nombre total de tickets correspondant au domaine, ou null si non déterminable. */
  total: number | null;
  hasMore: boolean;
  order: string;
  period: ResolvedRange;
  modeLimitations: string[];
}

export interface SemanticDeps {
  provider: EmbeddingProvider;
  store: VectorStore;
}

export interface HelpdeskTicketMessage {
  id: number;
  ticketId: number;
  authorId: number | null;
  authorName: string | null;
  date: string | null;
  messageType: string | null;
  subject: string | null;
  body: string | null;
  recordName: string | null;
  attachmentIds: number[];
  isInternal: boolean;
}

function buildFilterDomainForParams(params: SearchHelpdeskParams): OdooDomain {
  return buildFilterDomain({
    team_id: params.teamId,
    stage_id: params.stageId,
    partner_id: params.partnerId,
    user_id: params.userId,
    x_studio_produit: params.product,
  });
}

/** Domaine complet : texte (facultatif) + filtres d'égalité + période. */
export function buildHelpdeskDomain(params: SearchHelpdeskParams, range: ResolvedRange): OdooDomain {
  const textDomain =
    params.query === undefined
      ? []
      : buildMultiTermTextSearchDomain(TEXT_SEARCH_FIELDS, params.query);
  return combineDomainsAnd(
    textDomain,
    buildFilterDomainForParams(params),
    buildDateRangeDomain('create_date', range),
  );
}

/**
 * Résout les libellés des étiquettes de toute une page en **un seul** appel
 * `helpdesk.tag`, plutôt qu'un par ticket. Sans étiquette à résoudre, aucun appel
 * n'est émis.
 */
export async function resolveTagLabels(
  client: OdooClient,
  results: NormalizedResult[],
): Promise<Map<number, string>> {
  const ids = new Set<number>();
  for (const result of results) {
    for (const tagId of result.helpdesk?.tagIds ?? []) {
      ids.add(tagId);
    }
  }
  if (ids.size === 0) {
    return new Map();
  }

  const rows = await client.searchRead({
    model: 'helpdesk.tag',
    method: 'search_read',
    domain: [['id', 'in', [...ids]]],
    fields: ['id', 'name'],
    limit: ids.size,
  });

  const labels = new Map<number, string>();
  for (const row of rows) {
    if (typeof row.id === 'number' && typeof row.name === 'string') {
      labels.set(row.id, row.name);
    }
  }
  return labels;
}

/** Réécrit `tags` à partir des ids conservés. Un id sans libellé reste `#<id>`. */
export function applyTagLabels(
  results: NormalizedResult[],
  labels: ReadonlyMap<number, string>,
): void {
  for (const result of results) {
    const tagIds = result.helpdesk?.tagIds;
    if (!tagIds) continue;
    result.tags = tagIds.map((id) => labels.get(id) ?? `#${id}`);
  }
}

/**
 * Joint les `messageLimit` messages les plus récents à chaque ticket.
 *
 * Un seul `search_read` sur `[['res_id','in', ids]]` avec un `limit` global
 * serait plus économe, mais « les N derniers messages **par ticket** » ne
 * s'exprime pas ainsi : un ticket bavard épuiserait le quota et affamerait
 * silencieusement les suivants. On garde donc un appel par ticket, mené par
 * lots — le coût ne se paie plus que sur demande explicite.
 */
async function attachMessages(
  client: OdooClient,
  results: NormalizedResult[],
  messageLimit: number,
): Promise<void> {
  const targets = results.filter((result) => result.id > 0);

  for (let i = 0; i < targets.length; i += MESSAGE_FETCH_CONCURRENCY) {
    const batch = targets.slice(i, i + MESSAGE_FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (result) => {
        try {
          const { results: messages } = await searchHelpdeskTicketMessages(client, {
            ticketId: result.id,
            limit: messageLimit,
            offset: 0,
            order: 'id desc',
          });
          // Récupérés du plus récent au plus ancien, restitués chronologiquement.
          const history = messages
            .slice()
            .reverse()
            .map(
              (msg): TicketMessageSummary => ({
                id: msg.id,
                date: msg.date,
                author: msg.authorName,
                type: msg.messageType,
                isInternal: msg.isInternal,
                body: msg.body,
                subject: msg.subject,
              }),
            );
          result.history = history;
          result.messages = history;
        } catch {
          result.history = [];
          result.messages = [];
        }
      }),
    );
  }
}

async function searchLexical(
  client: OdooClient,
  params: SearchHelpdeskParams,
  domain: OdooDomain,
): Promise<{
  results: NormalizedResult[];
  ignoredFields: string[];
  ignoredFieldsDetail: IgnoredField[];
  rowCount: number;
}> {
  const { fields, ignoredFields, ignoredFieldsDetail } = filterAllowedFields(
    'helpdesk.ticket',
    params.fields,
  );
  const limit = Math.min(params.limit, env.MCP_MAX_RESULTS_PER_QUERY);

  const rows = await client.searchRead({
    model: 'helpdesk.ticket',
    method: 'search_read',
    domain,
    fields: withBaseFields(fields, HELPDESK_BASE_FIELDS),
    limit,
    offset: params.offset,
    order: buildOrderClause(params.order),
  });

  // Le score lexical reste calculé et exposé, mais ne réordonne plus la page :
  // trier après coup une tranche déjà découpée par Odoo ne classe rien
  // globalement et rendait la pagination incohérente (défaut D2).
  const results = rows.map((row) => mapHelpdeskTicketToNormalized(row)).map((result) => {
    if (params.query === undefined) return result;
    const score = scoreLexicalRelevance(params.query, result.title, result.content);
    return { ...result, relevanceScore: score.value, relevanceReason: score.reason };
  });

  return { results, ignoredFields, ignoredFieldsDetail, rowCount: rows.length };
}

export async function searchHelpdeskTicketMessages(
  client: OdooClient,
  params: GetHelpdeskTicketMessagesParams & { order?: string },
): Promise<{
  results: HelpdeskTicketMessage[];
  ignoredFields: string[];
  ignoredFieldsDetail: IgnoredField[];
  count: number;
  total: number;
  hasMore: boolean;
}> {
  const { fields, ignoredFields, ignoredFieldsDetail } = filterAllowedFields(
    'mail.message',
    params.fields,
  );
  const limit = Math.min(params.limit, env.MCP_MAX_RESULTS_PER_QUERY);
  const domain: OdooDomain = [
    ['model', '=', 'helpdesk.ticket'],
    ['res_id', '=', params.ticketId],
  ];

  const rows = await client.searchRead({
    model: 'mail.message',
    method: 'search_read',
    domain,
    fields,
    limit,
    offset: params.offset,
    order: params.order ?? 'id asc',
  });

  const results = rows.map((row) => {
    const author = extractMany2OneLabel(row.author_id);
    const subtype = extractMany2OneLabel(row.subtype_id);
    const rawAttachments = Array.isArray(row.attachment_ids) ? row.attachment_ids : [];
    const attachmentIds = rawAttachments.flatMap((value) => {
      if (typeof value === 'number') return [value];
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') return [value[0]];
      return [];
    });

    return {
      id: typeof row.id === 'number' ? row.id : 0,
      ticketId: params.ticketId,
      authorId: author.id,
      authorName: author.label,
      date: odooDatetimeToIso(row.date),
      messageType: typeof row.message_type === 'string' ? row.message_type : null,
      subject: typeof row.subject === 'string' ? row.subject : null,
      body: stripHtml(row.body),
      recordName: typeof row.record_name === 'string' ? row.record_name : null,
      attachmentIds,
      isInternal: subtype.label === 'internal' || row.is_internal === true,
    } satisfies HelpdeskTicketMessage;
  });

  return {
    results,
    ignoredFields,
    ignoredFieldsDetail,
    count: results.length,
    total: results.length,
    hasMore: rows.length === limit,
  };
}

export async function searchHelpdeskTickets(
  client: OdooClient,
  params: SearchHelpdeskParams,
  semanticDeps?: SemanticDeps,
): Promise<HelpdeskSearchResult> {
  const range = resolveDateRange(params);
  const domain = buildHelpdeskDomain(params, range);
  const order = buildOrderClause(params.order);
  const modeLimitations: string[] = [];

  const lexical = await searchLexical(client, params, domain);

  // Le total vient de `search_count` sur le même domaine, jamais de la taille de
  // la page : c'est ce qui rend « combien ? » répondable sans balayage (D3).
  const total = await client.searchCount({ model: 'helpdesk.ticket', domain });

  const finish = async (
    results: NormalizedResult[],
    resultTotal: number | null,
    hasMore: boolean,
  ): Promise<HelpdeskSearchResult> => {
    applyTagLabels(results, await resolveTagLabels(client, results));
    if (params.includeMessages) {
      await attachMessages(client, results, params.messageLimit);
    }
    return {
      results,
      ignoredFields: lexical.ignoredFields,
      ignoredFieldsDetail: lexical.ignoredFieldsDetail,
      count: results.length,
      total: resultTotal,
      hasMore,
      order,
      period: range,
      modeLimitations,
    };
  };

  const lexicalHasMore = params.offset + lexical.results.length < total;

  if (params.mode === 'text') {
    return finish(lexical.results, total, lexicalHasMore);
  }

  if (!semanticDeps) {
    modeLimitations.push(
      "mode sémantique/hybride demandé mais aucun fournisseur d'embeddings configuré — résultats en mode texte uniquement",
    );
    return finish(lexical.results, total, lexicalHasMore);
  }

  const { fields } = filterAllowedFields('helpdesk.ticket', params.fields);
  const limit = Math.min(params.limit, env.MCP_MAX_RESULTS_PER_QUERY);
  const semantic: SemanticSearchResult = await searchSemantic(
    client,
    'helpdesk.ticket',
    params.query ?? '',
    {
      limit,
      filterDomain: combineDomainsAnd(
        buildFilterDomainForParams(params),
        buildDateRangeDomain('create_date', range),
      ),
      fields: withBaseFields(fields, HELPDESK_BASE_FIELDS),
    },
    semanticDeps.provider,
    semanticDeps.store,
    mapHelpdeskTicketToNormalized,
  );

  if (semantic.cacheStatus.state === 'missing') {
    modeLimitations.push(
      "cache sémantique introuvable — exécutez 'npm run reindex'; résultats en mode texte uniquement",
    );
  } else if (semantic.cacheStatus.state === 'stale') {
    modeLimitations.push("cache sémantique périmé — exécutez 'npm run reindex' pour le rafraîchir");
  }

  if (params.mode === 'semantic') {
    if (semantic.cacheStatus.state === 'missing') {
      return finish(lexical.results, total, lexicalHasMore);
    }
    // Le total porterait sur les candidats du cache vectoriel, pas sur Odoo :
    // mieux vaut ne rien annoncer qu'un chiffre qui aurait l'air d'un total.
    modeLimitations.push(
      'total non calculé en mode sémantique : le classement porte sur le cache vectoriel local, ' +
        'pas sur un décompte Odoo. Utilisez le mode "text" ou helpdesk_stats pour un total exact.',
    );
    return finish(semantic.results, null, semantic.hasMore);
  }

  const merged = mergeHybridResults(
    lexical.results,
    semantic.results,
    { lexical: env.HYBRID_LEXICAL_WEIGHT, semantic: env.HYBRID_SEMANTIC_WEIGHT },
    limit,
  );
  return finish(merged, total, lexicalHasMore || semantic.hasMore);
}

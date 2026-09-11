import type { OdooClient } from '../clients/odooClient.js';
import {
  buildFilterDomain,
  buildMultiTermTextSearchDomain,
  combineDomainsAnd,
  type OdooDomain,
} from '../utils/domainBuilder.js';
import { buildDateRangeDomain, resolveDateRange, type ResolvedRange } from '../utils/dateRange.js';
import {
  MULTIVALUED_GROUP_BY,
  type HelpdeskStatsParams,
  type ListHelpdeskTeamsParams,
} from '../schemas/helpdeskStats.js';

const TEXT_SEARCH_FIELDS = ['name', 'description'] as const;

export interface GroupKeyPart {
  field: string;
  /** Renseigné pour les many2one uniquement. */
  id: number | null;
  /** Libellé lisible, ou null si le champ est vide sur ces tickets. */
  label: string | null;
}

export interface StatsGroup {
  key: GroupKeyPart[];
  count: number;
}

export interface HelpdeskStatsResult {
  total: number;
  sumOfGroups: number;
  groupBy: string[];
  period: ResolvedRange & { timezone: string };
  groupCount: number;
  groups: StatsGroup[];
  warnings: string[];
}

/**
 * Extrait le compteur d'une ligne `read_group`.
 *
 * Odoo renvoie `__count` avec `lazy: false`. Le repli `<champ>_count` couvre les
 * versions/chemins où seul le compteur du premier axe est présent.
 */
export function extractGroupCount(row: Record<string, unknown>, groupby: string[]): number {
  if (typeof row.__count === 'number') {
    return row.__count;
  }
  for (const field of groupby) {
    const fallback = row[`${baseFieldName(field)}_count`];
    if (typeof fallback === 'number') {
      return fallback;
    }
  }
  return 0;
}

/** `create_date:day` → `create_date`. */
function baseFieldName(groupByField: string): string {
  const separator = groupByField.indexOf(':');
  return separator === -1 ? groupByField : groupByField.slice(0, separator);
}

/**
 * Normalise la valeur d'un axe dans une ligne `read_group`.
 *
 * Formes rencontrées : many2one `[id, "Libellé"]`, sélection ou date déjà
 * formatée (chaîne), champ vide (`false`).
 */
export function normalizeGroupKeyPart(field: string, value: unknown): GroupKeyPart {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      field,
      id: typeof value[0] === 'number' ? value[0] : null,
      label: typeof value[1] === 'string' ? value[1] : null,
    };
  }
  if (typeof value === 'string') {
    return { field, id: null, label: value };
  }
  if (typeof value === 'number') {
    return { field, id: value, label: null };
  }
  // `false` : champ non renseigné sur ces tickets.
  return { field, id: null, label: null };
}

export function normalizeGroupRow(row: Record<string, unknown>, groupby: string[]): StatsGroup {
  return {
    key: groupby.map((field) => normalizeGroupKeyPart(field, row[field])),
    count: extractGroupCount(row, groupby),
  };
}

function buildStatsDomain(params: HelpdeskStatsParams, range: ResolvedRange): OdooDomain {
  const textDomain =
    params.query === undefined
      ? []
      : buildMultiTermTextSearchDomain(TEXT_SEARCH_FIELDS, params.query);
  return combineDomainsAnd(
    textDomain,
    buildFilterDomain({
      team_id: params.teamId,
      stage_id: params.stageId,
      partner_id: params.partnerId,
      user_id: params.userId,
      x_studio_produit: params.product,
    }),
    buildDateRangeDomain('create_date', range),
  );
}

export async function computeHelpdeskStats(
  client: OdooClient,
  params: HelpdeskStatsParams,
): Promise<HelpdeskStatsResult> {
  const range = resolveDateRange(params);
  const domain = buildStatsDomain(params, range);
  const context = { tz: params.timezone };

  // Les deux appels sont indépendants : le total ne dérive jamais des groupes.
  const [total, rows] = await Promise.all([
    client.searchCount({ model: 'helpdesk.ticket', domain }),
    client.readGroup({
      model: 'helpdesk.ticket',
      domain,
      fields: ['id'],
      groupby: [...params.groupBy],
      limit: params.limit,
      context,
    }),
  ]);

  const groups = rows.map((row) => normalizeGroupRow(row, [...params.groupBy]));
  const sumOfGroups = groups.reduce((sum, group) => sum + group.count, 0);

  const warnings: string[] = [];

  const multivalued = params.groupBy.filter((field) => MULTIVALUED_GROUP_BY.includes(field));
  if (multivalued.length > 0) {
    warnings.push(
      `Axe multivalué (${multivalued.join(', ')}) : un ticket portant plusieurs valeurs est ` +
        'compté dans chaque groupe, donc la somme des groupes peut dépasser le total. ' +
        'Les tickets sans valeur apparaissent dans un groupe dédié (libellé null).',
    );
  }

  if (rows.length === params.limit) {
    warnings.push(
      `Résultat tronqué à ${params.limit} groupes : la somme des groupes est incomplète. ` +
        'Augmentez limit ou restreignez la période.',
    );
  }

  if (sumOfGroups !== total && multivalued.length === 0 && rows.length < params.limit) {
    warnings.push(
      `La somme des groupes (${sumOfGroups}) diffère du total (${total}). ` +
        'Le total fait foi : il vient de search_count sur le même domaine.',
    );
  }

  if (params.groupBy.some((field) => field.startsWith('create_date:'))) {
    warnings.push(
      `Les paquets de dates suivent le fuseau ${params.timezone}, tandis que les bornes de la ` +
        'période sont en UTC — Odoo stocke les datetimes sans fuseau.',
    );
  }

  return {
    total,
    sumOfGroups,
    groupBy: [...params.groupBy],
    period: { ...range, timezone: params.timezone },
    groupCount: groups.length,
    groups,
    warnings,
  };
}

export interface HelpdeskTeam {
  id: number;
  name: string | null;
  companyId: number | null;
  companyName: string | null;
  active: boolean;
  ticketCount?: number;
}

export interface ListHelpdeskTeamsResult {
  count: number;
  results: HelpdeskTeam[];
  /** Fenêtre appliquée au décompte de tickets, si demandé. */
  ticketCountPeriod: ResolvedRange | null;
}

export async function listHelpdeskTeams(
  client: OdooClient,
  params: ListHelpdeskTeamsParams,
): Promise<ListHelpdeskTeamsResult> {
  const domain: OdooDomain =
    params.query === undefined ? [] : [['name', 'ilike', params.query]];

  const rows = await client.searchRead({
    model: 'helpdesk.team',
    method: 'search_read',
    domain,
    fields: ['id', 'name', 'company_id', 'active'],
    limit: params.limit,
    order: 'id asc',
  });

  const teams: HelpdeskTeam[] = rows.map((row) => {
    const company = Array.isArray(row.company_id) ? row.company_id : [null, null];
    return {
      id: typeof row.id === 'number' ? row.id : 0,
      name: typeof row.name === 'string' ? row.name : null,
      companyId: typeof company[0] === 'number' ? company[0] : null,
      companyName: typeof company[1] === 'string' ? company[1] : null,
      active: row.active === true,
    };
  });

  if (!params.includeTicketCount) {
    return { count: teams.length, results: teams, ticketCountPeriod: null };
  }

  // Un seul regroupement pour toutes les équipes, jamais un search_count chacune.
  const range = resolveDateRange({ lastDays: params.ticketCountLastDays });
  const countRows = await client.readGroup({
    model: 'helpdesk.ticket',
    domain: buildDateRangeDomain('create_date', range),
    fields: ['id'],
    groupby: ['team_id'],
    limit: 500,
  });

  const counts = new Map<number, number>();
  for (const row of countRows) {
    const key = normalizeGroupKeyPart('team_id', row.team_id);
    if (key.id !== null) {
      counts.set(key.id, extractGroupCount(row, ['team_id']));
    }
  }

  for (const team of teams) {
    team.ticketCount = counts.get(team.id) ?? 0;
  }

  return { count: teams.length, results: teams, ticketCountPeriod: range };
}

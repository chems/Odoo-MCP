import { env } from '../config/env.js';
import { stripHtml, truncate } from '../utils/truncate.js';
import { asString, extractMany2OneLabel, odooDatetimeToIso } from './common.js';
import type { HelpdeskDetails, NormalizedResult } from './types.js';

/**
 * L'URL vient de `access_url` (`/my/ticket/<id>`), chemin relatif du portail
 * Odoo, préfixé par `ODOO_BASE_URL`. Le jeton `access_token` qui l'accompagne
 * n'est **jamais** exposé : il ouvrirait le ticket sans authentification.
 *
 * `tags`, `updatedAt` et `url` ne sont plus déclarés indisponibles : les trois
 * sont désormais renseignés.
 */
function buildTicketUrl(raw: Record<string, unknown>): string | null {
  const path = asString(raw.access_url);
  if (path === null) return null;
  return path.startsWith('http') ? path : `${env.ODOO_BASE_URL}${path}`;
}

/** Ids d'un champ x2many Odoo, tolérant aux formes `[id, ...]` et `[[id, nom], ...]`. */
function extractIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    if (typeof item === 'number') return [item];
    if (Array.isArray(item) && typeof item[0] === 'number') return [item[0]];
    return [];
  });
}

export function mapHelpdeskTicketToNormalized(
  raw: Record<string, unknown>,
  tagLabels?: ReadonlyMap<number, string>,
): NormalizedResult {
  const id = typeof raw.id === 'number' ? raw.id : 0;
  const title = asString(raw.name) ?? `Ticket #${id}`;
  const descriptionText = stripHtml(raw.description as string | false | null | undefined);
  const stage = extractMany2OneLabel(raw.stage_id);
  const team = extractMany2OneLabel(raw.team_id);

  const url = buildTicketUrl(raw);

  const unavailableFields: string[] = [];
  if (url === null) {
    unavailableFields.push('url');
  }
  if (raw.description !== undefined && descriptionText === null) {
    unavailableFields.push('content');
  }

  // `null` = étiquettes non demandées à Odoo ; `[]` = ticket sans étiquette.
  const tagIds = raw.tag_ids === undefined ? null : (extractIds(raw.tag_ids) ?? []);
  const tags =
    tagIds === null
      ? null
      : tagIds.map((tagId) => tagLabels?.get(tagId) ?? `#${tagId}`);

  const helpdesk: HelpdeskDetails = {
    team: { id: team.id, label: team.label },
    tagIds,
    product: asString(raw.x_studio_produit),
    requesterRole: asString(raw.x_studio_fonction),
    priority: asString(raw.priority),
    kanbanState: asString(raw.kanban_state),
    closedAt: odooDatetimeToIso(raw.close_date),
    ticketRef: asString(raw.ticket_ref),
  };

  return {
    source: 'helpdesk',
    id,
    title,
    summary: truncate(descriptionText, 200),
    content: truncate(descriptionText, env.MCP_MAX_CONTENT_LENGTH),
    url,
    status: stage.label,
    tags,
    createdAt: odooDatetimeToIso(raw.create_date),
    updatedAt: odooDatetimeToIso(raw.write_date),
    // `history` / `messages` ne sont pas posés ici : les clés restent absentes
    // de la sortie tant que l'appelant ne demande pas le fil (lot 5).
    relevanceScore: null,
    relevanceReason: null,
    relatedResults: [],
    unavailableFields,
    helpdesk,
  };
}

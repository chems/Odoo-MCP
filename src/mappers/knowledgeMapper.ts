import { env } from '../config/env.js';
import { stripHtml, truncate } from '../utils/truncate.js';
import { asBoolean, asString, odooDatetimeToIso } from './common.js';
import type { NormalizedResult } from './types.js';

/**
 * `tags` n'existe sur aucun champ de knowledge.article (confirmé par le
 * fields_get complet du modèle) : toujours absent, jamais dérivé.
 */
const KNOWLEDGE_UNAVAILABLE_FIELDS = ['tags'] as const;

function deriveStatus(raw: Record<string, unknown>): string | null {
  if (asBoolean(raw.active) === false) {
    return 'archived';
  }
  if (asBoolean(raw.is_locked)) {
    return 'locked';
  }
  if (asBoolean(raw.is_published) || asBoolean(raw.website_published)) {
    return 'published';
  }
  return 'draft';
}

export function mapKnowledgeArticleToNormalized(raw: Record<string, unknown>): NormalizedResult {
  const id = typeof raw.id === 'number' ? raw.id : 0;
  const title = asString(raw.name) ?? `Article #${id}`;
  const bodyText = stripHtml(raw.body as string | false | null | undefined);
  const nativeSummary = asString(raw.summary);

  const unavailableFields: string[] = [...KNOWLEDGE_UNAVAILABLE_FIELDS];
  if (raw.body !== undefined && bodyText === null) {
    unavailableFields.push('content');
  }

  return {
    source: 'knowledge',
    id,
    title,
    summary: nativeSummary ?? truncate(bodyText, 200),
    content: truncate(bodyText, env.MCP_MAX_CONTENT_LENGTH),
    url: asString(raw.website_url) ?? asString(raw.article_url),
    status: deriveStatus(raw),
    tags: null,
    createdAt: odooDatetimeToIso(raw.create_date),
    updatedAt: odooDatetimeToIso(raw.write_date),
    history: null,
    messages: null,
    relevanceScore: null,
    relevanceReason: null,
    relatedResults: [],
    unavailableFields,
  };
}

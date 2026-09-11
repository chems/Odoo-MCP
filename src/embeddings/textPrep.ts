import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Construit le texte envoyé au modèle d'embedding pour un enregistrement Odoo :
 * titre + contenu, tronqué à `EMBEDDING_MAX_TEXT_LENGTH` (indépendant de
 * `MCP_MAX_CONTENT_LENGTH`, qui régit l'affichage, pas l'indexation).
 */
export function buildEmbeddingText(title: string, content: string | null): string {
  const text = content ? `${title}\n${content}` : title;
  return text.slice(0, env.EMBEDDING_MAX_TEXT_LENGTH);
}

/** Empreinte courte du texte indexé, pour détecter un changement de contenu indépendamment de `write_date`. */
export function hashText(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

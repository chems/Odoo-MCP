/**
 * Résolution des bornes temporelles et construction du domaine Odoo associé.
 *
 * Odoo stocke les datetimes **sans fuseau**, en UTC, au format
 * `YYYY-MM-DD HH:MM:SS`. Toutes les bornes produites ici sont donc de l'UTC naïf.
 * Une date nue (`2026-08-01`) vaut **minuit UTC**.
 */
import type { OdooDomain } from './domainBuilder.js';

export interface DateRangeInput {
  createdAfter?: string;
  createdBefore?: string;
  lastDays?: number;
}

export interface ResolvedRange {
  /** Borne basse **incluse**, ou null si la période est ouverte à gauche. */
  from: string | null;
  /** Borne haute **exclue**, ou null si la période est ouverte à droite. */
  to: string | null;
}

export const EMPTY_RANGE: ResolvedRange = { from: null, to: null };

export class InvalidDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateRangeError';
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Formate un `Date` en datetime Odoo naïf UTC. */
export function toOdooDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Convertit une date fournie par l'appelant en UTC naïf.
 * Accepte `YYYY-MM-DD` (→ minuit UTC) et l'ISO 8601 complet (→ converti en UTC).
 */
export function parseBoundary(value: string, paramName: string): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new InvalidDateRangeError(
        `${paramName} : "${value}" n'est pas une date valide. Format attendu : YYYY-MM-DD ou ISO 8601 complet.`,
      );
    }
    return toOdooDatetime(date);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidDateRangeError(
      `${paramName} : "${value}" n'est pas une date valide. Format attendu : YYYY-MM-DD ou ISO 8601 complet (ex. 2026-08-01T14:30:00Z).`,
    );
  }
  return toOdooDatetime(date);
}

/**
 * Résout `createdAfter` / `createdBefore` / `lastDays` en une paire de bornes.
 *
 * `lastDays` est exclusif des deux autres : les combiner produirait une fenêtre
 * ambiguë, on préfère une erreur nommée à un résultat que l'appelant croirait
 * comprendre.
 */
export function resolveDateRange(input: DateRangeInput, now: Date = new Date()): ResolvedRange {
  const { createdAfter, createdBefore, lastDays } = input;

  if (lastDays !== undefined && (createdAfter !== undefined || createdBefore !== undefined)) {
    throw new InvalidDateRangeError(
      'lastDays ne peut pas être combiné avec createdAfter ou createdBefore : ' +
        'utilisez soit une fenêtre glissante (lastDays), soit des bornes explicites.',
    );
  }

  if (lastDays !== undefined) {
    if (!Number.isInteger(lastDays) || lastDays <= 0) {
      throw new InvalidDateRangeError(
        `lastDays : "${lastDays}" est invalide. Attendu : un entier strictement positif (nombre de jours).`,
      );
    }
    return { from: toOdooDatetime(new Date(now.getTime() - lastDays * 86_400_000)), to: null };
  }

  const from = createdAfter !== undefined ? parseBoundary(createdAfter, 'createdAfter') : null;
  const to = createdBefore !== undefined ? parseBoundary(createdBefore, 'createdBefore') : null;

  // Période vide : refusée explicitement plutôt que renvoyer zéro résultat, qui
  // se lirait comme « aucun ticket » au lieu de « la question est mal posée ».
  if (from !== null && to !== null && from >= to) {
    throw new InvalidDateRangeError(
      `Période vide : createdAfter (${from}) est postérieur ou égal à createdBefore (${to}). ` +
        'La borne haute est exclusive.',
    );
  }

  return { from, to };
}

/**
 * Domaine Odoo pour une période résolue.
 *
 * Borne basse **incluse**, borne haute **exclue** : deux périodes contiguës ne
 * comptent ainsi jamais deux fois le même enregistrement.
 */
export function buildDateRangeDomain(field: string, range: ResolvedRange): OdooDomain {
  const domain: OdooDomain = [];
  if (range.from !== null) domain.push([field, '>=', range.from]);
  if (range.to !== null) domain.push([field, '<', range.to]);
  return domain;
}

export function isEmptyRange(range: ResolvedRange): boolean {
  return range.from === null && range.to === null;
}

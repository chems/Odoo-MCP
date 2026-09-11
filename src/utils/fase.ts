/**
 * Normalisation des numéros FASE et construction du domaine de recherche.
 *
 * Ce que mesurent les données réelles (2 065 sociétés, 09/09/2026 — voir
 * `CONTACTS-lot1-correspondance.md` §3) :
 *
 * - `x_studio_fase` est de type **char**, jamais integer ;
 * - **aucune** valeur ne porte de zéro de tête (`"03003"` ne correspond à rien) ;
 * - **76 valeurs sont composites** : `5448/3048`, `5437/1230`, `542/542`… Une
 *   fiche peut porter deux numéros séparés par `/`. C'est le vrai piège : un
 *   filtre `= "5448"` rate l'école ;
 * - le FASE **n'est pas unique** : 14 numéros sont portés par plusieurs fiches.
 */
import type { OdooDomain } from './domainBuilder.js';

export const FASE_FIELD = 'x_studio_fase';
export const FASE_PO_FIELD = 'x_studio_fase_po';

export class InvalidFaseError extends Error {
  constructor(received: unknown) {
    super(
      `Numéro FASE invalide : ${JSON.stringify(received)}. ` +
        'Attendu : un nombre ou une chaîne non vide (ex. 3003, "3003", "5448/3048").',
    );
    this.name = 'InvalidFaseError';
  }
}

export interface NormalizedFase {
  /** Valeur telle que fournie, réduite à une chaîne. */
  raw: string;
  /** Formes interrogées, dans l'ordre. */
  variants: string[];
  /** Explication destinée à l'appelant, conformément au principe « les erreurs enseignent ». */
  explanation: string;
}

/**
 * Réduit une entrée (entier ou chaîne) aux formes à interroger.
 *
 * Odoo coerce l'entier vers la chaîne pour l'opérateur `=`, donc `3003` et
 * `"3003"` donnent le même résultat — mesuré. On interroge tout de même la
 * forme sans zéros de tête, au cas où une source externe en ajouterait.
 */
export function normalizeFase(input: string | number): NormalizedFase {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0) {
      throw new InvalidFaseError(input);
    }
  } else if (typeof input !== 'string' || input.trim().length === 0) {
    throw new InvalidFaseError(input);
  }

  const raw = String(input).trim();
  const variants = [raw];

  // Zéros de tête : absents des données, mais fréquents dans les sources
  // externes. On interroge les deux formes plutôt que de trancher.
  const sansZeros = raw.replace(/^0+(?=\d)/, '');
  if (sansZeros !== raw) variants.push(sansZeros);

  const explanation =
    variants.length > 1
      ? `FASE "${raw}" interrogé aussi sans zéro de tête ("${sansZeros}") ; les numéros composites (ex. "5448/3048") sont également reconnus.`
      : `FASE "${raw}" interrogé en exact et à l'intérieur des numéros composites (ex. "${raw}/1234" ou "1234/${raw}").`;

  return { raw, variants, explanation };
}

/**
 * Domaine Odoo pour un FASE, couvrant les valeurs composites.
 *
 * Pour chaque forme : égalité exacte, ou présence comme fragment d'une valeur
 * `a/b`. `like` (et non `ilike`) suffit, les FASE ne contenant pas de lettres —
 * hors la valeur isolée `"B"`, qui n'est de toute façon pas un numéro.
 */
export function buildFaseDomain(fase: NormalizedFase, field: string = FASE_FIELD): OdooDomain {
  const clauses: unknown[] = [];
  for (const value of fase.variants) {
    clauses.push([field, '=', value], [field, 'like', `${value}/%`], [field, 'like', `%/${value}`]);
  }
  // Notation préfixe Odoo : N clauses en OR nécessitent (N-1) opérateurs `|`.
  return [...new Array(clauses.length - 1).fill('|'), ...clauses];
}

/** Découpe une valeur stockée en ses numéros constitutifs. */
export function splitFaseValue(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  return value
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Un FASE est-il purement numérique ? 76 valeurs sur 1 672 ne le sont pas. */
export function isPlainNumericFase(value: string): boolean {
  return /^\d+$/.test(value);
}

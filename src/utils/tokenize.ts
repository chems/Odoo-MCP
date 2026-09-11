const STOPWORDS = new Set([
  // Français
  'les', 'des', 'une', 'un', 'le', 'la', 'de', 'du', 'et', 'est', 'pour', 'que', 'qui',
  'dans', 'sur', 'par', 'avec', 'pas', 'vous', 'nous', 'ils', 'elle', 'son', 'sont',
  'cette', 'ces', 'ont', 'été', 'être', 'avoir', 'plus', 'aussi', 'mais', 'ou', 'où',
  'peut', 'fait', 'faire', 'tout', 'tous', 'toute', 'toutes', 'votre', 'notre', 'leur',
  // Anglais
  'the', 'and', 'for', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'you',
  'your', 'with', 'this', 'that', 'from', 'can', 'will', 'all', 'any', 'been',
]);

const COMBINING_DIACRITICS_RANGE = new RegExp('[\\u0300-\\u036f]', 'g');

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(COMBINING_DIACRITICS_RANGE, '');
}

/**
 * Normalise et tokenise un texte (name+body / name+description) pour le
 * rapprochement lexical de search_all : minuscules, sans accents, découpage
 * sur non-alphanumériques, filtre les mots-outils et les tokens trop courts.
 */
export function normalizeAndTokenize(text: string | null | undefined): Set<string> {
  if (!text) {
    return new Set();
  }
  const normalized = stripAccents(text.toLowerCase());
  const rawTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = rawTokens.filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

const MAX_ODOO_TERMS = 8;

/**
 * Découpe une requête utilisateur en termes de recherche Odoo (domain `ilike`).
 * Contrairement à `normalizeAndTokenize`, préserve accents et casse : `ilike`
 * est insensible à la casse côté Postgres mais pas aux accents (pas d'extension
 * `unaccent` supposée). Filtre uniquement les mots-outils et tokens trop courts,
 * pour transformer "connexion utilisateurs ProEco5" en un AND de 3 termes plutôt
 * qu'un unique substring littéral qui ne matche jamais.
 */
export function splitQueryIntoOdooTerms(query: string): string[] {
  const rawTerms = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const terms = rawTerms.filter((term) => term.length >= 2 && !STOPWORDS.has(term.toLowerCase()));
  if (terms.length === 0) {
    return [query.trim()];
  }
  return terms.slice(0, MAX_ODOO_TERMS);
}

/**
 * Extrait des candidats de référence (numéros de ticket/document) d'un texte :
 * séquences numériques de 4 chiffres ou plus, ou motifs `#123`. Utilisé comme
 * signal complémentaire (bonus) dans le scoring de rapprochement search_all.
 */
export function extractReferenceCandidates(text: string | null | undefined): Set<string> {
  if (!text) {
    return new Set();
  }
  const matches = text.match(/#\d+|\b\d{4,}\b/g) ?? [];
  return new Set(matches.map((m) => m.replace(/^#/, '')));
}

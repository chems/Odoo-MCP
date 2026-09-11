import { normalizeAndTokenize } from '../utils/tokenize.js';

const TITLE_WEIGHT = 2;
const BODY_WEIGHT = 1;

export interface RelevanceScore {
  value: number;
  reason: string;
}

/**
 * Score de pertinence lexicale d'un résultat par rapport à la requête utilisateur :
 * recouvrement de tokens normalisés (minuscules, sans accents) entre `query` et
 * `title`/`content`, le titre pesant deux fois plus que le corps. `reason` liste
 * les tokens réellement matchés par champ (jamais un score opaque), dans le même
 * esprit que le rapprochement lexical de `crossSearchService.ts`.
 */
export function scoreLexicalRelevance(
  query: string,
  title: string | null | undefined,
  content: string | null | undefined,
): RelevanceScore {
  const queryTokens = normalizeAndTokenize(query);
  if (queryTokens.size === 0) {
    return { value: 0, reason: 'aucun terme de recherche exploitable' };
  }

  const titleTokens = normalizeAndTokenize(title);
  const contentTokens = normalizeAndTokenize(content);

  const titleMatches = [...queryTokens].filter((token) => titleTokens.has(token));
  const bodyMatches = [...queryTokens].filter((token) => contentTokens.has(token));

  const maxScore = queryTokens.size * (TITLE_WEIGHT + BODY_WEIGHT);
  const rawScore = titleMatches.length * TITLE_WEIGHT + bodyMatches.length * BODY_WEIGHT;
  const value = Math.min(1, rawScore / maxScore);

  const parts: string[] = [];
  if (titleMatches.length > 0) {
    parts.push(`titre: ${titleMatches.join(', ')} (${titleMatches.length}/${queryTokens.size})`);
  }
  if (bodyMatches.length > 0) {
    parts.push(`corps: ${bodyMatches.join(', ')} (${bodyMatches.length}/${queryTokens.size})`);
  }
  const reason = parts.length > 0 ? parts.join(' ; ') : 'aucun terme commun (correspondance hors champs indexés)';

  return { value, reason };
}

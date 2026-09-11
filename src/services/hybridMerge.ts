import type { NormalizedResult } from '../mappers/types.js';

export interface HybridWeights {
  lexical: number;
  semantic: number;
}

/**
 * Fusionne un jeu de résultats lexicaux et un jeu de résultats sémantiques :
 * dédoublonnage par id, score combiné = pondération des deux scores (le côté
 * absent d'un résultat compte pour 0 — un item trouvé par une seule méthode est
 * donc mécaniquement moins bien classé qu'un item que les deux méthodes
 * confirment ; limite connue, documentée plutôt que cachée).
 */
export function mergeHybridResults(
  lexical: NormalizedResult[],
  semantic: NormalizedResult[],
  weights: HybridWeights,
  limit: number,
): NormalizedResult[] {
  const byId = new Map<number, NormalizedResult & { lexicalScore: number; semanticScore: number }>();

  for (const result of lexical) {
    byId.set(result.id, { ...result, lexicalScore: result.relevanceScore ?? 0, semanticScore: 0 });
  }
  for (const result of semantic) {
    const existing = byId.get(result.id);
    if (existing) {
      existing.semanticScore = result.relevanceScore ?? 0;
      existing.relevanceReason =
        existing.relevanceReason && result.relevanceReason
          ? `${existing.relevanceReason} ; ${result.relevanceReason}`
          : (existing.relevanceReason ?? result.relevanceReason);
    } else {
      byId.set(result.id, { ...result, lexicalScore: 0, semanticScore: result.relevanceScore ?? 0 });
    }
  }

  return [...byId.values()]
    .map((entry) => {
      const { lexicalScore, semanticScore, ...result } = entry;
      return { ...result, relevanceScore: weights.lexical * lexicalScore + weights.semantic * semanticScore };
    })
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, limit);
}

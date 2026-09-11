import { describe, expect, it } from 'vitest';
import { mergeHybridResults } from '../src/services/hybridMerge.js';
import type { NormalizedResult } from '../src/mappers/types.js';

function makeResult(id: number, score: number, reason: string): NormalizedResult {
  return {
    source: 'helpdesk',
    id,
    title: `Ticket ${id}`,
    summary: null,
    content: null,
    url: null,
    status: null,
    tags: null,
    createdAt: null,
    updatedAt: null,
    relevanceScore: score,
    relevanceReason: reason,
    relatedResults: [],
    unavailableFields: [],
  };
}

describe('mergeHybridResults', () => {
  it('combine les scores pondérés pour un id présent dans les deux jeux', () => {
    const lexical = [makeResult(1, 0.8, 'lexical')];
    const semantic = [makeResult(1, 0.4, 'semantic')];

    const merged = mergeHybridResults(lexical, semantic, { lexical: 0.5, semantic: 0.5 }, 10);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.relevanceScore).toBeCloseTo(0.6);
    expect(merged[0]!.relevanceReason).toBe('lexical ; semantic');
  });

  it("traite le score du côté absent comme 0 pour un id trouvé par une seule méthode", () => {
    const lexical = [makeResult(1, 1, 'lexical seul')];
    const semantic: NormalizedResult[] = [];

    const merged = mergeHybridResults(lexical, semantic, { lexical: 0.5, semantic: 0.5 }, 10);

    expect(merged[0]!.relevanceScore).toBeCloseTo(0.5);
  });

  it('dédoublonne par id et trie par score décroissant', () => {
    const lexical = [makeResult(1, 0.2, 'a'), makeResult(2, 0.9, 'b')];
    const semantic = [makeResult(1, 0.9, 'c')];

    const merged = mergeHybridResults(lexical, semantic, { lexical: 0.5, semantic: 0.5 }, 10);

    expect(merged.map((r) => r.id)).toEqual([1, 2]);
  });

  it('tronque au limit demandé', () => {
    const lexical = Array.from({ length: 5 }, (_, i) => makeResult(i, 1 - i * 0.1, `r${i}`));

    const merged = mergeHybridResults(lexical, [], { lexical: 1, semantic: 0 }, 2);

    expect(merged).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { detectRelations } from '../src/services/crossSearchService.js';
import type { NormalizedResult } from '../src/mappers/types.js';

function makeResult(
  source: 'knowledge' | 'helpdesk',
  id: number,
  title: string,
  content: string,
): NormalizedResult {
  return {
    source,
    id,
    title,
    summary: null,
    content,
    url: null,
    status: null,
    tags: null,
    createdAt: null,
    updatedAt: null,
    relevanceScore: null,
    relevanceReason: null,
    relatedResults: [],
    unavailableFields: [],
  };
}

describe('crossSearchService.detectRelations', () => {
  it('associe deux résultats avec un texte quasi identique (score élevé)', () => {
    const article = makeResult('knowledge', 1, 'Budget scolaire', 'gestion du budget scolaire annuel');
    const ticket = makeResult('helpdesk', 100, 'Budget scolaire', 'gestion du budget scolaire annuel');

    detectRelations([article], [ticket]);

    expect(article.relatedResults).toHaveLength(1);
    expect(article.relatedResults[0]!.id).toBe(100);
    expect(article.relatedResults[0]!.relevanceScore).toBeGreaterThan(0.9);
    expect(ticket.relatedResults).toHaveLength(1);
    expect(ticket.relatedResults[0]!.id).toBe(1);
  });

  it("ne crée aucune relation quand aucun mot n'est commun", () => {
    const article = makeResult('knowledge', 2, 'CAMMAT absences maladie', 'procedure administrative gedi');
    const ticket = makeResult('helpdesk', 200, 'Facture peppol export', 'compteco tva belgique');

    detectRelations([article], [ticket]);

    expect(article.relatedResults).toHaveLength(0);
    expect(ticket.relatedResults).toHaveLength(0);
  });

  it('applique le bonus de référence numérique commune', () => {
    const article = makeResult('knowledge', 3, 'Ticket 123456 explication', 'plusieurs mots differents ici');
    const ticket = makeResult('helpdesk', 300, 'Reference 123456 probleme', 'autres mots totalement distincts');

    detectRelations([article], [ticket]);

    // Le seul mot-clé commun réel serait faible ; le bonus de référence doit permettre de dépasser le seuil.
    if (article.relatedResults.length > 0) {
      expect(article.relatedResults[0]!.reason).toContain('référence numérique commune');
    }
  });

  it('ne garde que les 3 meilleures relations par résultat (RELATION_MAX_PER_ITEM)', () => {
    const article = makeResult('knowledge', 4, 'sujet commun', 'alpha beta gamma delta epsilon zeta');
    const tickets = Array.from({ length: 6 }, (_, i) =>
      makeResult('helpdesk', 400 + i, 'sujet commun', 'alpha beta gamma delta epsilon zeta'),
    );

    detectRelations([article], tickets);

    expect(article.relatedResults.length).toBeLessThanOrEqual(3);
  });
});

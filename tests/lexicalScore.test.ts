import { describe, expect, it } from 'vitest';
import { scoreLexicalRelevance } from '../src/scoring/lexicalScore.js';

describe('scoreLexicalRelevance', () => {
  it('donne un score maximal quand tous les termes matchent le titre et le corps', () => {
    const score = scoreLexicalRelevance('connexion proeco5', 'Connexion ProEco5 impossible', 'connexion proeco5');
    expect(score.value).toBe(1);
    expect(score.reason).toContain('titre:');
  });

  it("plafonne à 2/3 quand seul le titre matche (le corps pèse pour le tiers restant)", () => {
    const score = scoreLexicalRelevance('connexion proeco5', 'Connexion ProEco5 impossible', null);
    expect(score.value).toBeCloseTo(2 / 3);
  });

  it('pondère le titre plus fort que le corps', () => {
    const titleMatch = scoreLexicalRelevance('connexion', 'Connexion impossible', 'rien à voir ici');
    const bodyMatch = scoreLexicalRelevance('connexion', 'Sans rapport', 'problème de connexion signalé');
    expect(titleMatch.value).toBeGreaterThan(bodyMatch.value);
  });

  it('retourne un score de 0 et une raison explicite si aucun terme commun', () => {
    const score = scoreLexicalRelevance('facturation peppol', 'Connexion impossible', 'mot de passe oublié');
    expect(score.value).toBe(0);
    expect(score.reason).toContain('aucun terme commun');
  });

  it('gère une requête sans token exploitable (uniquement mots-outils)', () => {
    const score = scoreLexicalRelevance('et de la', 'Peu importe', null);
    expect(score.value).toBe(0);
    expect(score.reason).toContain('aucun terme de recherche exploitable');
  });
});

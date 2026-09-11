import { describe, expect, it } from 'vitest';
import { splitQueryIntoOdooTerms } from '../src/utils/tokenize.js';

describe('splitQueryIntoOdooTerms', () => {
  it('découpe une requête multi-mots en préservant accents et casse', () => {
    expect(splitQueryIntoOdooTerms('connexion utilisateurs ProEco5')).toEqual([
      'connexion',
      'utilisateurs',
      'ProEco5',
    ]);
  });

  it('préserve les accents (pas de normalizeAndTokenize ici : ilike ne gère pas unaccent)', () => {
    expect(splitQueryIntoOdooTerms('problème école')).toEqual(['problème', 'école']);
  });

  it('filtre les mots-outils courants', () => {
    expect(splitQueryIntoOdooTerms('le ticket de connexion')).toEqual(['ticket', 'connexion']);
  });

  it('retombe sur la requête brute complète si tous les termes sont filtrés', () => {
    expect(splitQueryIntoOdooTerms('et de la')).toEqual(['et de la']);
  });

  it('plafonne à 8 termes maximum', () => {
    const query = Array.from({ length: 12 }, (_, i) => `motclef${i}`).join(' ');
    expect(splitQueryIntoOdooTerms(query)).toHaveLength(8);
  });

  it('supporte un terme unique (comportement historique inchangé)', () => {
    expect(splitQueryIntoOdooTerms('ProEco5')).toEqual(['ProEco5']);
  });
});

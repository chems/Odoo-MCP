import { describe, expect, it } from 'vitest';
import {
  buildFilterDomain,
  buildMultiTermTextSearchDomain,
  buildTextSearchDomain,
  combineDomainsAnd,
} from '../src/utils/domainBuilder.js';

describe('domainBuilder', () => {
  it('ne met aucun "|" pour un seul champ', () => {
    expect(buildTextSearchDomain(['name'], 'x')).toEqual([['name', 'ilike', 'x']]);
  });

  it('met un seul "|" pour deux champs', () => {
    expect(buildTextSearchDomain(['name', 'body'], 'x')).toEqual([
      '|',
      ['name', 'ilike', 'x'],
      ['body', 'ilike', 'x'],
    ]);
  });

  it('met deux "|" en tête pour trois champs', () => {
    expect(buildTextSearchDomain(['a', 'b', 'c'], 'x')).toEqual([
      '|',
      '|',
      ['a', 'ilike', 'x'],
      ['b', 'ilike', 'x'],
      ['c', 'ilike', 'x'],
    ]);
  });

  it('buildFilterDomain ignore les valeurs undefined', () => {
    expect(buildFilterDomain({ isPublished: undefined, team_id: 3 })).toEqual([['team_id', '=', 3]]);
  });

  it('combineDomainsAnd concatène les blocs à plat', () => {
    const text = buildTextSearchDomain(['name', 'body'], 'budget');
    const filters = buildFilterDomain({ parent_id: 12 });
    expect(combineDomainsAnd(text, filters)).toEqual([
      '|',
      ['name', 'ilike', 'budget'],
      ['body', 'ilike', 'budget'],
      ['parent_id', '=', 12],
    ]);
  });

  it('buildMultiTermTextSearchDomain produit un unique bloc OR pour un seul terme (identique à buildTextSearchDomain)', () => {
    expect(buildMultiTermTextSearchDomain(['name', 'body'], 'ProEco5')).toEqual(
      buildTextSearchDomain(['name', 'body'], 'ProEco5'),
    );
  });

  it('buildMultiTermTextSearchDomain construit un AND de blocs OR pour une requête multi-mots', () => {
    // Reproduit le bug réel observé : "connexion utilisateurs ProEco5" en un seul
    // substring littéral ne matche rien ; en AND de 3 termes, ça doit fonctionner.
    expect(buildMultiTermTextSearchDomain(['name', 'description'], 'connexion utilisateurs ProEco5')).toEqual([
      '|',
      ['name', 'ilike', 'connexion'],
      ['description', 'ilike', 'connexion'],
      '|',
      ['name', 'ilike', 'utilisateurs'],
      ['description', 'ilike', 'utilisateurs'],
      '|',
      ['name', 'ilike', 'ProEco5'],
      ['description', 'ilike', 'ProEco5'],
    ]);
  });

  it("buildMultiTermTextSearchDomain retombe sur le substring complet si tous les mots sont des mots-outils", () => {
    expect(buildMultiTermTextSearchDomain(['name'], 'et de la')).toEqual([['name', 'ilike', 'et de la']]);
  });
});

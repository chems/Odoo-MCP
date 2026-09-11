import { describe, expect, it } from 'vitest';
import {
  InvalidFaseError,
  buildFaseDomain,
  isPlainNumericFase,
  normalizeFase,
  splitFaseValue,
} from '../src/utils/fase.js';

describe('normalizeFase', () => {
  it('accepte indifféremment un entier et une chaîne', () => {
    // Mesuré : Odoo coerce l'entier vers la chaîne pour `=`, les deux formes
    // donnent le même résultat. Le §1.3 du plan supposait le contraire.
    expect(normalizeFase(3003).variants).toEqual(['3003']);
    expect(normalizeFase('3003').variants).toEqual(['3003']);
  });

  it('interroge aussi la forme sans zéro de tête', () => {
    const { variants } = normalizeFase('03003');
    expect(variants).toEqual(['03003', '3003']);
  });

  it('conserve les numéros composites tels quels', () => {
    expect(normalizeFase('5448/3048').variants).toEqual(['5448/3048']);
  });

  it('rogne les espaces parasites', () => {
    expect(normalizeFase('  3003  ').raw).toBe('3003');
  });

  it('explique la normalisation appliquée', () => {
    expect(normalizeFase('03003').explanation).toMatch(/sans zéro de tête/);
    expect(normalizeFase('3003').explanation).toMatch(/composites/);
  });

  it('refuse une entrée vide ou absurde', () => {
    expect(() => normalizeFase('')).toThrow(InvalidFaseError);
    expect(() => normalizeFase('   ')).toThrow(InvalidFaseError);
    expect(() => normalizeFase(-1)).toThrow(InvalidFaseError);
    expect(() => normalizeFase(3.5)).toThrow(InvalidFaseError);
    expect(() => normalizeFase(Number.NaN)).toThrow(InvalidFaseError);
  });

  it('nomme les formes attendues dans le message d\'erreur', () => {
    expect(() => normalizeFase('')).toThrow(/Numéro FASE invalide/);
    expect(() => normalizeFase('')).toThrow(/5448\/3048/);
  });
});

describe('buildFaseDomain', () => {
  it('couvre l\'égalité exacte ET les valeurs composites', () => {
    // 76 FASE sur 1672 sont de la forme "a/b" : un filtre `= "5448"` les raterait.
    const domain = buildFaseDomain(normalizeFase('5448'));
    expect(domain).toEqual([
      '|',
      '|',
      ['x_studio_fase', '=', '5448'],
      ['x_studio_fase', 'like', '5448/%'],
      ['x_studio_fase', 'like', '%/5448'],
    ]);
  });

  it('produit une expression préfixe OR valide (N-1 opérateurs pour N clauses)', () => {
    const domain = buildFaseDomain(normalizeFase('03003'));
    const ops = domain.filter((c) => c === '|').length;
    const clauses = domain.filter((c) => Array.isArray(c)).length;
    expect(clauses).toBe(6); // 2 formes × 3 clauses
    expect(ops).toBe(clauses - 1);
  });

  it('accepte un champ cible différent (FASE du pouvoir organisateur)', () => {
    const domain = buildFaseDomain(normalizeFase('1057'), 'x_studio_fase_po');
    expect(domain).toContainEqual(['x_studio_fase_po', '=', '1057']);
  });
});

describe('splitFaseValue', () => {
  it('découpe une valeur composite', () => {
    expect(splitFaseValue('5448/3048')).toEqual(['5448', '3048']);
    expect(splitFaseValue('542/542')).toEqual(['542', '542']);
  });

  it('renvoie la valeur seule quand elle est simple', () => {
    expect(splitFaseValue('3003')).toEqual(['3003']);
  });

  it('tolère les valeurs absentes', () => {
    expect(splitFaseValue(false)).toEqual([]);
    expect(splitFaseValue(null)).toEqual([]);
    expect(splitFaseValue('')).toEqual([]);
  });
});

describe('isPlainNumericFase', () => {
  it('repère les 76 valeurs non numériques observées', () => {
    expect(isPlainNumericFase('3003')).toBe(true);
    expect(isPlainNumericFase('5448/3048')).toBe(false);
    expect(isPlainNumericFase('B')).toBe(false);
  });
});

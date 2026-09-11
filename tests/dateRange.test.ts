import { describe, expect, it } from 'vitest';
import {
  InvalidDateRangeError,
  buildDateRangeDomain,
  parseBoundary,
  resolveDateRange,
  toOdooDatetime,
} from '../src/utils/dateRange.js';

const NOW = new Date('2026-09-09T11:16:20Z');

describe('dateRange', () => {
  describe('conversion', () => {
    it('formate en UTC naïf, le format que stocke Odoo', () => {
      expect(toOdooDatetime(new Date('2026-09-02T09:36:07Z'))).toBe('2026-09-02 09:36:07');
    });

    it('une date nue vaut minuit UTC', () => {
      expect(parseBoundary('2026-08-01', 'createdAfter')).toBe('2026-08-01 00:00:00');
    });

    it("convertit un ISO 8601 avec décalage vers l'UTC", () => {
      // 14:30 en heure d'été belge (UTC+2) = 12:30 UTC.
      expect(parseBoundary('2026-08-01T14:30:00+02:00', 'createdAfter')).toBe('2026-08-01 12:30:00');
      expect(parseBoundary('2026-08-01T14:30:00Z', 'createdAfter')).toBe('2026-08-01 14:30:00');
    });

    it('rejette une date invalide en nommant le paramètre', () => {
      expect(() => parseBoundary('pas-une-date', 'createdBefore')).toThrow(InvalidDateRangeError);
      expect(() => parseBoundary('pas-une-date', 'createdBefore')).toThrow(/createdBefore/);
      expect(() => parseBoundary('2026-13-45', 'createdAfter')).toThrow(InvalidDateRangeError);
    });
  });

  describe('résolution de période', () => {
    it('sans borne, la période est ouverte des deux côtés', () => {
      expect(resolveDateRange({}, NOW)).toEqual({ from: null, to: null });
    });

    it('lastDays produit une fenêtre glissante ouverte à droite', () => {
      expect(resolveDateRange({ lastDays: 30 }, NOW)).toEqual({
        from: '2026-08-10 11:16:20',
        to: null,
      });
    });

    it('accepte des bornes explicites', () => {
      expect(resolveDateRange({ createdAfter: '2026-08-01', createdBefore: '2026-09-01' }, NOW)).toEqual({
        from: '2026-08-01 00:00:00',
        to: '2026-09-01 00:00:00',
      });
    });

    it('refuse lastDays combiné à une borne explicite', () => {
      expect(() => resolveDateRange({ lastDays: 30, createdAfter: '2026-08-01' }, NOW)).toThrow(
        InvalidDateRangeError,
      );
      expect(() => resolveDateRange({ lastDays: 30, createdBefore: '2026-09-01' }, NOW)).toThrow(
        /lastDays ne peut pas être combiné/,
      );
    });

    it('refuse une période vide plutôt que de renvoyer zéro résultat', () => {
      expect(() =>
        resolveDateRange({ createdAfter: '2026-09-01', createdBefore: '2026-08-01' }, NOW),
      ).toThrow(/Période vide/);
      // Bornes égales : la borne haute étant exclusive, la période est vide.
      expect(() =>
        resolveDateRange({ createdAfter: '2026-08-01', createdBefore: '2026-08-01' }, NOW),
      ).toThrow(/Période vide/);
    });

    it('refuse un lastDays non entier ou négatif', () => {
      expect(() => resolveDateRange({ lastDays: 0 }, NOW)).toThrow(InvalidDateRangeError);
      expect(() => resolveDateRange({ lastDays: -5 }, NOW)).toThrow(InvalidDateRangeError);
      expect(() => resolveDateRange({ lastDays: 1.5 }, NOW)).toThrow(InvalidDateRangeError);
    });
  });

  describe('domaine Odoo', () => {
    it('borne basse incluse, borne haute exclue', () => {
      expect(
        buildDateRangeDomain('create_date', { from: '2026-08-01 00:00:00', to: '2026-09-01 00:00:00' }),
      ).toEqual([
        ['create_date', '>=', '2026-08-01 00:00:00'],
        ['create_date', '<', '2026-09-01 00:00:00'],
      ]);
    });

    it('deux périodes contiguës ne comptent pas deux fois le même ticket', () => {
      const aout = buildDateRangeDomain('create_date', {
        from: '2026-08-01 00:00:00',
        to: '2026-09-01 00:00:00',
      });
      const septembre = buildDateRangeDomain('create_date', {
        from: '2026-09-01 00:00:00',
        to: '2026-10-01 00:00:00',
      });
      // Le 01/09 à 00:00:00 est exclu d'août (`<`) et inclus en septembre (`>=`).
      expect(aout[1]).toEqual(['create_date', '<', '2026-09-01 00:00:00']);
      expect(septembre[0]).toEqual(['create_date', '>=', '2026-09-01 00:00:00']);
    });

    it('omet les bornes absentes', () => {
      expect(buildDateRangeDomain('create_date', { from: '2026-08-01 00:00:00', to: null })).toEqual([
        ['create_date', '>=', '2026-08-01 00:00:00'],
      ]);
      expect(buildDateRangeDomain('create_date', { from: null, to: null })).toEqual([]);
    });
  });
});

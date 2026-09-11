import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HELPDESK_ORDER,
  HELPDESK_ORDER_VALUES,
  InvalidOrderError,
  buildOrderClause,
  isAllowedOrder,
} from '../src/utils/order.js';

describe('order', () => {
  it('applique le tri par défaut quand rien n\'est demandé', () => {
    expect(buildOrderClause()).toBe('create_date desc, id desc');
    expect(DEFAULT_HELPDESK_ORDER).toBe('create_date desc');
  });

  it('ajoute un départage par id pour rendre la pagination déterministe (D2)', () => {
    // create_date n'est pas unique : sans `id desc`, deux pages peuvent se
    // chevaucher ou omettre des tickets.
    expect(buildOrderClause('create_date desc')).toBe('create_date desc, id desc');
    expect(buildOrderClause('priority desc')).toBe('priority desc, id desc');
    expect(buildOrderClause('write_date asc')).toBe('write_date asc, id desc');
  });

  it('ne redouble pas le départage quand le tri porte déjà sur id', () => {
    expect(buildOrderClause('id desc')).toBe('id desc');
    expect(buildOrderClause('id asc')).toBe('id asc');
  });

  it('accepte les 10 valeurs de la liste blanche', () => {
    expect(HELPDESK_ORDER_VALUES).toHaveLength(10);
    for (const value of HELPDESK_ORDER_VALUES) {
      expect(() => buildOrderClause(value)).not.toThrow();
    }
  });

  it('normalise la casse et les espaces superflus', () => {
    expect(buildOrderClause('  CREATE_DATE DESC ')).toBe('create_date desc, id desc');
  });

  it('rejette toute valeur hors liste blanche, injection comprise', () => {
    const refusees = [
      'name desc',
      'create_date',
      'create_date desc; DROP TABLE',
      "create_date desc, (SELECT 1)",
      'id desc, name asc',
      '',
    ];
    for (const value of refusees) {
      expect(() => buildOrderClause(value), value).toThrow(InvalidOrderError);
      expect(isAllowedOrder(value)).toBe(false);
    }
  });

  it("nomme les valeurs acceptées dans le message d'erreur, en français", () => {
    expect(() => buildOrderClause('name desc')).toThrow(/Tri invalide : "name desc"/);
    expect(() => buildOrderClause('name desc')).toThrow(/Valeurs acceptées.*create_date desc/s);
  });
});

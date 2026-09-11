/**
 * Construction de la clause `ORDER BY` transmise à Odoo.
 *
 * Le paramètre reçu du client MCP n'est jamais repris tel quel : il est validé
 * contre une liste blanche fermée (schéma zod côté entrée, `buildOrderClause`
 * côté service), puis reconstruit. Aucune chaîne libre n'atteint Odoo.
 */

/** Champs sur lesquels un tri est autorisé. Tous existent sur `helpdesk.ticket`. */
export const ALLOWED_ORDER_FIELDS = [
  'create_date',
  'write_date',
  'id',
  'priority',
  'close_date',
] as const;

export const ORDER_DIRECTIONS = ['asc', 'desc'] as const;

export type AllowedOrderField = (typeof ALLOWED_ORDER_FIELDS)[number];
export type OrderDirection = (typeof ORDER_DIRECTIONS)[number];

/**
 * Les 10 valeurs acceptées, énumérées pour que le schéma MCP les expose à
 * l'appelant plutôt que de le laisser deviner.
 */
export const HELPDESK_ORDER_VALUES = ALLOWED_ORDER_FIELDS.flatMap((field) =>
  ORDER_DIRECTIONS.map((direction) => `${field} ${direction}` as const),
);

export type HelpdeskOrder = (typeof HELPDESK_ORDER_VALUES)[number];

export const DEFAULT_HELPDESK_ORDER: HelpdeskOrder = 'create_date desc';

/**
 * Départage systématique par `id desc`.
 *
 * Sans lui, la pagination reste non déterministe : `create_date` n'est pas
 * unique — plusieurs tickets partagent couramment la même seconde — et Odoo est
 * alors libre de renvoyer deux pages qui se chevauchent ou qui omettent des
 * enregistrements. C'est précisément le symptôme du défaut D2.
 */
export function buildOrderClause(order: string = DEFAULT_HELPDESK_ORDER): string {
  const normalized = order.trim().toLowerCase();
  if (!isAllowedOrder(normalized)) {
    throw new InvalidOrderError(order);
  }
  return normalized.startsWith('id ') ? normalized : `${normalized}, id desc`;
}

export function isAllowedOrder(value: string): value is HelpdeskOrder {
  return (HELPDESK_ORDER_VALUES as readonly string[]).includes(value);
}

export class InvalidOrderError extends Error {
  constructor(received: string) {
    super(
      `Tri invalide : "${received}". Valeurs acceptées : ${HELPDESK_ORDER_VALUES.join(', ')}.`,
    );
    this.name = 'InvalidOrderError';
  }
}

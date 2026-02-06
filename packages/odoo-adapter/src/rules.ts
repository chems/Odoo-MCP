import type { Domain, DomainCondition } from "./types.js";

/**
 * Opérateurs de comparaison supportés pour les conditions Odoo
 * 
 * Documentation Odoo :
 * - Comparaison : =, !=, >, >=, <, <=
 * - Texte : like, ilike, not like
 * - Collections : in, not in
 * - Relations : child_of (trouve enfants/petits-enfants), parent_left, parent_right
 */
export type Operator = 
  | "=" | "!=" | ">" | ">=" | "<" | "<=" 
  | "like" | "ilike" | "not like"
  | "in" | "not in"
  | "child_of" | "parent_left" | "parent_right";

/**
 * Condition simple : ["field", "operator", value]
 */
export type Condition = [string, Operator, unknown];

/**
 * Règle logique récursive pour construire des domaines Odoo de manière déclarative
 * 
 * Supporte AND, OR et NOT (opérateur unaire)
 * 
 * Exemple :
 * ```ts
 * const rule: Rule = {
 *   and: [
 *     {
 *       or: [
 *         ['id', '=', 1],
 *         ['id', '=', 2],
 *       ],
 *     },
 *     { not: ['is_company', '=', true] },
 *   ],
 * };
 * ```
 */
export type Rule =
  | Condition
  | {
      and?: Rule[];
      or?: Rule[];
      not?: Rule;  // NOT est un opérateur unaire (aritré 1)
    };

/**
 * Helpers (optionnels mais utiles)
 */
export function AND(...rules: Rule[]): Rule {
  return { and: rules };
}

export function OR(...rules: Rule[]): Rule {
  return { or: rules };
}

export function NOT(rule: Rule): Rule {
  return { not: rule };
}

export function COND(field: string, operator: Operator, value: unknown): Condition {
  return [field, operator, value];
}

/**
 * Conversion Rule -> Domain Odoo "polonais" plat.
 *
 * C'est la forme la plus fiable sur les instances SaaS:
 * - AND de N termes => "&" répété (N-1 fois) puis tous les sous-domaines aplatis
 * - OR  de N termes => "|" répété (N-1 fois) puis tous les sous-domaines aplatis
 * - NOT => "!" puis sous-domaine aplati
 *
 * Exemple: (id=1 OR id=2) AND is_company=true
 * => ["&", "|", ["id","=",1], ["id","=",2], ["is_company","=",true]]
 */
function repeat(op: "&" | "|", n: number): Array<"&" | "|"> {
  return Array.from({ length: n }, () => op);
}

function flatten(rule: Rule): Domain {
  // Condition simple
  if (Array.isArray(rule)) return [rule as unknown as DomainCondition];

  // NOT
  if (rule.not !== undefined) {
    return ["!", ...flatten(rule.not)] as Domain;
  }

  // AND
  if (rule.and) {
    if (rule.and.length === 0) throw new Error("AND rule must contain at least one condition");
    if (rule.and.length === 1) return flatten(rule.and[0]);
    return [...repeat("&", rule.and.length - 1), ...rule.and.flatMap(flatten)] as Domain;
  }

  // OR
  if (rule.or) {
    if (rule.or.length === 0) throw new Error("OR rule must contain at least one condition");
    if (rule.or.length === 1) return flatten(rule.or[0]);
    return [...repeat("|", rule.or.length - 1), ...rule.or.flatMap(flatten)] as Domain;
  }

  throw new Error("Invalid rule: must have 'and', 'or', or 'not' property, or be a Condition");
}

/**
 * Convertit une règle déclarative en domaine Odoo
 * 
 * @param rule - La règle à convertir
 * @returns Le domaine Odoo au format attendu
 * 
 * @example
 * ```ts
 * const rule: Rule = {
 *   and: [
 *     { or: [['id', '=', 1], ['id', '=', 2]] },
 *     ['is_company', '=', true],
 *   ],
 * };
 * const domain = toOdooDomain(rule);
 * // Résultat : ["&", "|", ["id","=",1], ["id","=",2], ["is_company","=",true]]
 * ```
 */
export function toOdooDomain(rule: Rule): Domain {
  // Condition simple => domain avec 1 seule condition
  if (Array.isArray(rule)) {
    return [rule as unknown as DomainCondition];
  }
  return flatten(rule);
}

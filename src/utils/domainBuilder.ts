import { splitQueryIntoOdooTerms } from './tokenize.js';

export type OdooDomain = unknown[];

export type FilterPrimitive = string | number | boolean;

/**
 * Construit une clause de recherche texte Odoo (`ilike`, insensible à la casse)
 * en OR sur plusieurs champs, avec la notation préfixe Odoo : N champs
 * nécessitent (N-1) opérateurs "|" en tête.
 *
 *   buildTextSearchDomain(['name'], 'x')         -> [['name','ilike','x']]
 *   buildTextSearchDomain(['name','body'], 'x')  -> ['|', ['name','ilike','x'], ['body','ilike','x']]
 */
export function buildTextSearchDomain(fields: readonly string[], query: string): OdooDomain {
  if (fields.length === 0) {
    return [];
  }
  const ors = new Array(Math.max(fields.length - 1, 0)).fill('|');
  const clauses = fields.map((field) => [field, 'ilike', query]);
  return [...ors, ...clauses];
}

/**
 * Construit un domain "plein texte" multi-mots : chaque terme de `query` doit
 * apparaître (AND) dans au moins un des `fields` (OR), au lieu de traiter toute
 * la requête comme un seul substring littéral. Chaque terme produit un bloc
 * `buildTextSearchDomain` déjà autonome (ses `|` ne consomment que ses propres
 * tuples) ; les concaténer via `combineDomainsAnd` donne un AND-de-blocs-OR
 * correct, sans nouvelle algèbre de domain.
 *
 *   buildMultiTermTextSearchDomain(['name','body'], 'connexion ProEco5')
 *   -> ['|',['name','ilike','connexion'],['body','ilike','connexion'],
 *       '|',['name','ilike','ProEco5'],['body','ilike','ProEco5']]
 */
export function buildMultiTermTextSearchDomain(fields: readonly string[], query: string): OdooDomain {
  const terms = splitQueryIntoOdooTerms(query);
  return combineDomainsAnd(...terms.map((term) => buildTextSearchDomain(fields, term)));
}

/**
 * Construit une liste de tuples simples `[champ, "=", valeur]` à partir d'un
 * objet de filtres déjà validé (les clés `undefined` sont ignorées). Odoo
 * traite une liste de tuples simples juxtaposés comme un AND implicite.
 */
export function buildFilterDomain(filters: Record<string, FilterPrimitive | undefined>): OdooDomain {
  const domain: OdooDomain = [];
  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    domain.push([field, '=', value]);
  }
  return domain;
}

/**
 * Combine plusieurs domaines Odoo déjà "fermés" (expressions préfixes complètes,
 * éventuellement des tuples simples) en un seul domaine, avec un AND implicite
 * entre chaque bloc. Ne jamais reconstruire un domaine "|" à la volée à partir
 * de fragments : toujours passer par buildTextSearchDomain pour ce bloc.
 */
export function combineDomainsAnd(...domains: OdooDomain[]): OdooDomain {
  return domains.flat().filter((clause) => clause !== undefined);
}

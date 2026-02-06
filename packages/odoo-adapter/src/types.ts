export type OdooId = number;

/**
 * Domaine Odoo (format JSON-RPC / ORM)
 *
 * Représentation "polonaise" plate (celle la plus fiable en pratique) :
 * - Conditions: ["field", "operator", value]
 * - Opérateurs logiques: "&" (AND), "|" (OR), "!" (NOT)
 *
 * Exemples:
 * - AND de 2 conditions: ["&", ["id","=",1], ["is_company","=",true]]
 * - OR de 2 conditions:  ["|", ["id","=",1], ["id","=",2]]
 * - (id=1 OR id=2) AND is_company=true:
 *   ["&", "|", ["id","=",1], ["id","=",2], ["is_company","=",true]]
 *
 * Note: Odoo accepte aussi des AND implicites sous forme de liste de conditions,
 * mais on privilégie ici la forme explicite/plate car elle évite des erreurs serveur
 * sur certaines instances en SaaS.
 */
export type DomainCondition = [string, string, unknown];
export type DomainToken = "&" | "|" | "!" | DomainCondition;
export type Domain = DomainToken[];

export interface NameSearchOptions {
  limit?: number;
  operator?: string; // e.g. 'ilike'
  args?: Domain;     // additional domain filter
}

export interface SearchReadOptions {
  fields?: string[] | ["__all__"];  // Liste de champs ou ["__all__"] pour tous les champs
  limit?: number;
  offset?: number;
  order?: string;
}

export interface OdooCredentials {
  url: string;      // base url, e.g. https://xxx.odoo.com
  db: string;
  login?: string;   // user login/email (optional if uid is provided)
  apiKey: string;   // API key used as password for RPC
  uid?: number;     // optional (cached)
}

export class OdooError extends Error {
  public readonly code?: number;
  public readonly data?: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = "OdooError";
    this.code = code;
    this.data = data;
  }
}

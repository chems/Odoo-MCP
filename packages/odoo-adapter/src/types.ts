export type OdooId = number;

/**
 * Type récursif pour les domaines Odoo supportant les opérateurs logiques OR/AND
 * 
 * Format Odoo :
 * - Condition simple : ["field", "operator", "value"]
 * - OR : ["|", domain1, domain2] = domain1 OU domain2
 * - AND : ["&", domain1, domain2] = domain1 ET domain2
 * - Par défaut, plusieurs conditions sont en AND : [cond1, cond2] = cond1 ET cond2
 */
export type DomainCondition = [string, string, unknown];
export type DomainOperator = "|" | "&";
export type Domain = 
  | DomainCondition 
  | [DomainOperator, Domain, Domain]
  | Domain[];

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

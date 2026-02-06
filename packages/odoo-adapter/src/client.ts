import type { Domain, NameSearchOptions, OdooCredentials, SearchReadOptions } from "./types.js";
import { OdooJsonRpcClient } from "./jsonrpc.js";
import { readOdooCredentialsFromEnv } from "./config.js";

/**
 * Helpers pour construire des domaines avec opérateurs logiques
 * 
 * Format Odoo :
 * - OR : ["|", condition1, condition2]
 * - AND implicite : [condition1, condition2] = condition1 ET condition2
 * - AND explicite : ["&", condition1, condition2]
 * - Combiner OR + AND : [["|", cond1, cond2], cond3] = (cond1 OU cond2) ET cond3
 * 
 * Les conditions doivent être des tuples simples : ["field", "operator", "value"]
 */
export function domainOR(...conditions: Domain[]): Domain {
  if (conditions.length === 0) return [];
  if (conditions.length === 1) return conditions[0];
  
  // Pour 2 conditions : ["|", condition1, condition2]
  if (conditions.length === 2) {
    return ["|", conditions[0], conditions[1]] as Domain;
  }
  
  // Pour plus de 2 conditions : construire récursivement
  // ["|", condition1, ["|", condition2, condition3]]
  return conditions.reduce((acc, condition) => {
    if (!acc) return condition;
    return ["|", acc, condition] as Domain;
  });
}

export function domainAND(...conditions: Domain[]): Domain {
  if (conditions.length === 0) return [];
  if (conditions.length === 1) return conditions[0];
  
  // Pour combiner OR et AND, utiliser AND implicite d'Odoo (tableau plat)
  // En Odoo, [cond1, cond2] = cond1 ET cond2 (AND implicite)
  // Donc [["|", cond1, cond2], cond3] = (cond1 OU cond2) ET cond3
  // Vérifier si une des conditions est un OR ou un AND imbriqué
  const hasNestedOperator = conditions.some(c => 
    Array.isArray(c) && (c[0] === "|" || c[0] === "&")
  );
  
  if (hasNestedOperator) {
    // AND implicite : retourner un tableau avec toutes les conditions
    // Format : [["|", cond1, cond2], cond3] = (cond1 OU cond2) ET cond3
    return conditions as Domain;
  }
  
  // Pour 2 conditions simples : ["&", condition1, condition2]
  if (conditions.length === 2) {
    return ["&", conditions[0], conditions[1]] as Domain;
  }
  
  // Pour plus de 2 conditions simples : construire récursivement
  // ["&", condition1, ["&", condition2, condition3]]
  return conditions.reduce((acc, condition) => {
    if (!acc) return condition;
    return ["&", acc, condition] as Domain;
  });
}

/** Helpers génériques */
async function nameSearch(
  rpc: OdooJsonRpcClient,
  model: string,
  query: string,
  options: NameSearchOptions = {}
): Promise<Array<{ id: number; name: string }>> {
  // Construire le domain : [["name", "ilike", query]] ou utiliser options.args si fourni
  const operator = options.operator ?? "ilike";
  const domain: Domain = options.args && options.args.length > 0 
    ? options.args 
    : [["name", operator, query]];
  
  const result = await rpc.executeKw<Array<{ id: number; name: string }>>(
    model,
    "search_read",
    [domain],  // args = [domain] où domain = [["field", "operator", "value"]]
    {
      fields: ["id", "name"],  // Champs à retourner
      limit: options.limit ?? 10
    }
  );
  return result;
}

async function searchRead<T extends Record<string, unknown>>(
  rpc: OdooJsonRpcClient,
  model: string,
  domain: Domain,
  options: SearchReadOptions = {}
): Promise<T[]> {
  return rpc.executeKw<T[]>(
    model,
    "search_read",
    [domain],
    {
      fields: options.fields ?? [],
      limit: options.limit ?? 80,
      offset: options.offset ?? 0,
      order: options.order
    }
  );
}

async function create(
  rpc: OdooJsonRpcClient,
  model: string,
  vals: Record<string, unknown>
): Promise<number> {
  return rpc.executeKw<number>(model, "create", [vals]);
}

async function write(
  rpc: OdooJsonRpcClient,
  model: string,
  ids: number[],
  vals: Record<string, unknown>
): Promise<boolean> {
  return rpc.executeKw<boolean>(model, "write", [ids, vals]);
}

export type OdooClient = ReturnType<typeof createOdooClient>;

export function createOdooClient(creds: OdooCredentials) {
  const rpc = new OdooJsonRpcClient(creds);

  return {
    rpc,

    partners: {
      nameSearch: (query: string, options?: NameSearchOptions) => nameSearch(rpc, "res.partner", query, options),
      searchRead: <T extends Record<string, unknown>>(domain: Domain, options?: SearchReadOptions) =>
        searchRead<T>(rpc, "res.partner", domain, options),
      create: (vals: Record<string, unknown>) => create(rpc, "res.partner", vals),
      write: (ids: number[], vals: Record<string, unknown>) => write(rpc, "res.partner", ids, vals)
    },

    products: {
      nameSearch: (query: string, options?: NameSearchOptions) => nameSearch(rpc, "product.product", query, options),
      searchRead: <T extends Record<string, unknown>>(domain: Domain, options?: SearchReadOptions) =>
        searchRead<T>(rpc, "product.product", domain, options),
      create: (vals: Record<string, unknown>) => create(rpc, "product.product", vals),
      write: (ids: number[], vals: Record<string, unknown>) => write(rpc, "product.product", ids, vals)
    },

    saleOrders: {
      searchRead: <T extends Record<string, unknown>>(domain: Domain, options?: SearchReadOptions) =>
        searchRead<T>(rpc, "sale.order", domain, options),
      create: (vals: Record<string, unknown>) => create(rpc, "sale.order", vals),
      write: (ids: number[], vals: Record<string, unknown>) => write(rpc, "sale.order", ids, vals)
    },

    saleOrderLines: {
      searchRead: <T extends Record<string, unknown>>(domain: Domain, options?: SearchReadOptions) =>
        searchRead<T>(rpc, "sale.order.line", domain, options),
      create: (vals: Record<string, unknown>) => create(rpc, "sale.order.line", vals),
      write: (ids: number[], vals: Record<string, unknown>) => write(rpc, "sale.order.line", ids, vals)
    },

    attachments: {
      create: (vals: Record<string, unknown>) => create(rpc, "ir.attachment", vals)
    },

    chatter: {
      postMessage: (vals: Record<string, unknown>) => create(rpc, "mail.message", vals)
    }
  };
}

export function createOdooClientFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const creds = readOdooCredentialsFromEnv(env);
  return createOdooClient(creds);
}

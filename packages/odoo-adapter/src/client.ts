import type { Domain, NameSearchOptions, OdooCredentials, SearchReadOptions } from "./types.js";
import { OdooJsonRpcClient } from "./jsonrpc.js";
import { readOdooCredentialsFromEnv } from "./config.js";
import type { Rule } from "./rules.js";
import { toOdooDomain } from "./rules.js";

function isAllFields(fields: SearchReadOptions["fields"]): fields is ["__all__"] {
  return Array.isArray(fields) && fields.length === 1 && fields[0] === "__all__";
}

function isLogicalToken(t: Domain[number]): t is "&" | "|" | "!" {
  return t === "&" || t === "|" || t === "!";
}

function isConditionList(domain: Domain): boolean {
  return domain.length > 0 && domain.every((t) => !isLogicalToken(t));
}

/**
 * Normalise un domain "liste de conditions" en forme "polonaise" explicite.
 * Ex:
 * - [[a],[b],[c]] => ["&","&",[a],[b],[c]]
 */
function normalizeImplicitAnd(domain: Domain): Domain {
  if (domain.length <= 1) return domain;
  if (!isConditionList(domain)) return domain;
  return [...Array.from({ length: domain.length - 1 }, () => "&"), ...domain] as Domain;
}

function andExpr(a: Domain, b: Domain): Domain {
  const aa = normalizeImplicitAnd(a);
  const bb = normalizeImplicitAnd(b);
  if (aa.length === 0) return bb;
  if (bb.length === 0) return aa;
  return ["&", ...aa, ...bb] as Domain;
}

/** Helpers génériques */
async function nameSearch(
  rpc: OdooJsonRpcClient,
  model: string,
  query: string,
  options: NameSearchOptions = {}
): Promise<Array<{ id: number; name: string }>> {
  const operator = options.operator ?? "ilike";

  // Domain de base: [["name", op, query]]
  const base: Domain = [["name", operator, query]];

  // Si options.args est fourni, il s'agit d'un filtre supplémentaire (AND)
  const domain =
    options.args && options.args.length > 0
      ? (query.trim().length > 0 ? andExpr(base, options.args) : normalizeImplicitAnd(options.args))
      : base;
  
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
  const kwargs: Record<string, unknown> = {
    limit: options.limit ?? 80,
    offset: options.offset ?? 0
  };
  if (options.order) kwargs.order = options.order;
  if (options.fields !== undefined && !isAllFields(options.fields)) kwargs.fields = options.fields;

  return rpc.executeKw<T[]>(
    model,
    "search_read",
    [domain],
    kwargs
  );
}

async function searchReadWithRule<T extends Record<string, unknown>>(
  rpc: OdooJsonRpcClient,
  model: string,
  rule: Rule,
  options: SearchReadOptions = {}
): Promise<T[]> {
  const domain = toOdooDomain(rule);
  return searchRead<T>(rpc, model, domain, options);
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
      searchReadRule: <T extends Record<string, unknown>>(rule: Rule, options?: SearchReadOptions) =>
        searchReadWithRule<T>(rpc, "res.partner", rule, options),
      create: (vals: Record<string, unknown>) => create(rpc, "res.partner", vals),
      write: (ids: number[], vals: Record<string, unknown>) => write(rpc, "res.partner", ids, vals)
    },

    products: {
      nameSearch: (query: string, options?: NameSearchOptions) => nameSearch(rpc, "product.product", query, options),
      searchRead: <T extends Record<string, unknown>>(domain: Domain, options?: SearchReadOptions) =>
        searchRead<T>(rpc, "product.product", domain, options),
      searchReadRule: <T extends Record<string, unknown>>(rule: Rule, options?: SearchReadOptions) =>
        searchReadWithRule<T>(rpc, "product.product", rule, options),
      create: (vals: Record<string, unknown>) => create(rpc, "product.product", vals),
      write: (ids: number[], vals: Record<string, unknown>) => write(rpc, "product.product", ids, vals)
    },

    saleOrders: {
      searchRead: <T extends Record<string, unknown>>(domain: Domain, options?: SearchReadOptions) =>
        searchRead<T>(rpc, "sale.order", domain, options),
      searchReadRule: <T extends Record<string, unknown>>(rule: Rule, options?: SearchReadOptions) =>
        searchReadWithRule<T>(rpc, "sale.order", rule, options),
      create: (vals: Record<string, unknown>) => create(rpc, "sale.order", vals),
      write: (ids: number[], vals: Record<string, unknown>) => write(rpc, "sale.order", ids, vals)
    },

    saleOrderLines: {
      searchRead: <T extends Record<string, unknown>>(domain: Domain, options?: SearchReadOptions) =>
        searchRead<T>(rpc, "sale.order.line", domain, options),
      searchReadRule: <T extends Record<string, unknown>>(rule: Rule, options?: SearchReadOptions) =>
        searchReadWithRule<T>(rpc, "sale.order.line", rule, options),
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

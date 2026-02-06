import type { OdooCredentials } from "./types.js";
import { OdooError } from "./types.js";
import { readOdooCredentialsFromEnv } from "./config.js";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: "call";
  params: {
    service: "common" | "object";
    method: string;
    args: unknown[];
  };
  id: number;
};

type JsonRpcResponse<T> =
  | { jsonrpc: "2.0"; id: number; result: T }
  | { jsonrpc: "2.0"; id: number; error: { code: number; message: string; data?: unknown } };

export class OdooJsonRpcClient {
  private readonly endpoint: string;
  private requestId = 1;

  constructor(private creds: OdooCredentials, private fetchImpl: typeof fetch = fetch) {
    this.endpoint = `${creds.url}/jsonrpc`;
  }

  /**
   * login() retourne le uid via service=common, method=login
   */
  async login(): Promise<number> {
    if (!this.creds.login) {
      throw new OdooError("Login is required but not provided in credentials");
    }
    const uid = await this.call<number>("common", "login", [
      this.creds.db,
      this.creds.login,
      this.creds.apiKey
    ]);
    if (!uid || typeof uid !== "number") {
      throw new OdooError("Odoo login returned invalid uid");
    }
    this.creds.uid = uid;
    return uid;
  }

  /**
   * execute_kw : service=object, method=execute_kw
   */
  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
  ): Promise<T> {
    const uid = this.creds.uid ?? (await this.login());
    return this.call<T>("object", "execute_kw", [
      this.creds.db,
      uid,
      this.creds.apiKey,
      model,
      method,
      args,
      kwargs
    ]);
  }

  private async call<T>(service: "common" | "object", method: string, args: unknown[]): Promise<T> {
    // Utiliser l'UID comme id de la requête JSON-RPC (requis par cette instance Odoo)
    // Pour login(), uid n'est pas encore défini, donc on utilise 0 temporairement
    // Pour tous les autres appels, on utilise this.creds.uid qui est défini par executeKw()
    const rpcId = service === "common" && method === "login" 
      ? 0  // Login n'a pas encore d'UID
      : (this.creds.uid ?? 0);  // Utiliser l'UID pour tous les autres appels
    
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: rpcId
    };

    // Debug: log JSON-RPC body (API key masquée) pour faciliter le diagnostic
    try {
      const safeArgs = Array.isArray(req.params.args) ? [...req.params.args] : req.params.args;
      if (Array.isArray(safeArgs) && safeArgs.length >= 3) {
        // Position 2 = apiKey dans [db, uid, apiKey, model, method, args, kwargs]
        safeArgs[2] = "***masked_api_key***";
      }
      const debugPayload = {
        ...req,
        params: {
          ...req.params,
          args: safeArgs
        }
      };
      // Utiliser console.debug pour ne pas polluer les logs en prod si filtrés
      console.debug("[odoo-adapter] JSON-RPC request:", JSON.stringify(debugPayload, null, 2));
    } catch {
      // Ne jamais casser l'appel en cas d'erreur de log
    }

    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OdooError(`HTTP ${res.status} calling Odoo JSON-RPC`, res.status, body);
    }

    const data = (await res.json()) as JsonRpcResponse<T>;
    if ("error" in data) {
      throw new OdooError(data.error.message, data.error.code, data.error.data);
    }
    return data.result;
  }
}

/**
 * Helper function for direct Odoo calls using environment variables.
 * Creates a singleton client instance from env vars.
 */
let singletonClient: OdooJsonRpcClient | null = null;

function getClient(): OdooJsonRpcClient {
  if (!singletonClient) {
    const creds = readOdooCredentialsFromEnv();
    singletonClient = new OdooJsonRpcClient(creds);
  }
  return singletonClient;
}

/**
 * Convenience function to call Odoo methods directly.
 * Uses credentials from environment variables.
 */
export async function odooCall<T = unknown>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const client = getClient();
  return client.executeKw<T>(model, method, args, kwargs);
}

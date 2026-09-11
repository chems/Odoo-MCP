export class OdooOperationNotAllowedError extends Error {
  constructor(model: string, method: string) {
    super(`Opération non autorisée: (model="${model}", method="${method}") n'est pas dans la liste blanche read-only.`);
    this.name = 'OdooOperationNotAllowedError';
  }
}

export interface OdooJsonRpcErrorData {
  name?: string;
  message?: string;
  debug?: string;
  arguments?: unknown[];
}

export class OdooJsonRpcError extends Error {
  constructor(
    public readonly data: OdooJsonRpcErrorData,
    public readonly httpStatus?: number,
  ) {
    super(data.message ?? 'Erreur Odoo JSON-RPC non spécifiée.');
    this.name = 'OdooJsonRpcError';
  }
}

export class OdooAuthorizationError extends Error {
  constructor(message = 'Accès refusé par Odoo pour ce modèle ou cet enregistrement.') {
    super(message);
    this.name = 'OdooAuthorizationError';
  }
}

export class OdooValidationError extends Error {
  constructor(message = "Requête invalide refusée par Odoo (modèle, méthode ou domaine).") {
    super(message);
    this.name = 'OdooValidationError';
  }
}

export class OdooTimeoutError extends Error {
  constructor(message = "Odoo n'a pas répondu dans le délai imparti.") {
    super(message);
    this.name = 'OdooTimeoutError';
  }
}

export class OdooUnavailableError extends Error {
  constructor(message = 'Odoo est indisponible ou a renvoyé une erreur serveur persistante.') {
    super(message);
    this.name = 'OdooUnavailableError';
  }
}

export interface McpToolError {
  code: string;
  message: string;
}

/**
 * Normalise n'importe quelle erreur interne en un message MCP sûr : jamais de secret
 * (ODOO_API_KEY, ODOO_UID) ni de traceback Odoo brut (`debug`) ne doit y figurer.
 */
export function toMcpToolError(err: unknown): McpToolError {
  if (err instanceof OdooOperationNotAllowedError) {
    return { code: 'OPERATION_NOT_ALLOWED', message: err.message };
  }
  if (err instanceof OdooAuthorizationError) {
    return { code: 'AUTHORIZATION_ERROR', message: err.message };
  }
  if (err instanceof OdooValidationError) {
    return { code: 'VALIDATION_ERROR', message: err.message };
  }
  if (err instanceof OdooTimeoutError) {
    return { code: 'TIMEOUT', message: err.message };
  }
  if (err instanceof OdooUnavailableError) {
    return { code: 'UNAVAILABLE', message: err.message };
  }
  if (err instanceof OdooJsonRpcError) {
    return { code: 'ODOO_ERROR', message: err.data.message ?? 'Erreur Odoo non spécifiée.' };
  }
  if (err instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: err.message };
  }
  return { code: 'INTERNAL_ERROR', message: 'Erreur interne inattendue.' };
}

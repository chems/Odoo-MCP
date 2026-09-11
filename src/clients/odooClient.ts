import axios, { AxiosError, type AxiosInstance } from 'axios';
import { env, maskSecret } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { assertAllowedOperation, type AllowedMethod, type AllowedModel } from '../security/whitelist.js';
import {
  OdooAuthorizationError,
  OdooJsonRpcError,
  OdooTimeoutError,
  OdooUnavailableError,
  OdooValidationError,
} from '../security/errors.js';
import type { OdooDomain } from '../utils/domainBuilder.js';

export interface SearchReadParams {
  model: AllowedModel;
  method: AllowedMethod;
  domain: OdooDomain;
  fields: string[];
  limit: number;
  offset?: number;
  /** Tri Odoo standard (ex. `'id asc'`) — nécessaire pour une pagination déterministe (réindexation). */
  order?: string;
  /** Contexte Odoo (ex. `{ tz: 'Europe/Brussels' }`). Jamais de clé d'écriture. */
  context?: Record<string, unknown>;
}

export interface SearchCountParams {
  model: AllowedModel;
  domain: OdooDomain;
  context?: Record<string, unknown>;
}

export interface ReadGroupParams {
  model: AllowedModel;
  domain: OdooDomain;
  /** Champs agrégés. `['id']` suffit : seul `__count` nous intéresse. */
  fields: string[];
  groupby: string[];
  limit?: number;
  offset?: number;
  orderby?: string;
  context?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data?: {
      name?: string;
      message?: string;
      debug?: string;
      arguments?: unknown[];
    };
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

function isRetryableHttpError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const axiosErr = err as AxiosError;
  if (axiosErr.code === 'ECONNABORTED') return false; // timeout is handled separately, never retried here
  if (!axiosErr.response) return true; // network error (no response at all)
  return axiosErr.response.status >= 500;
}

function classifyAuthError(name: string | undefined): boolean {
  if (!name) return false;
  return /AccessError|AccessDenied/i.test(name);
}

function classifyValidationError(name: string | undefined): boolean {
  if (!name) return false;
  return /ValidationError|MissingError|UserError/i.test(name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let requestCounter = 0;
function nextRequestId(): number {
  requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER;
  return requestCounter;
}

export class OdooClient {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http =
      http ??
      axios.create({
        baseURL: env.ODOO_BASE_URL,
        timeout: env.ODOO_HTTP_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });
  }

  /**
   * Point de passage unique vers Odoo. `assertAllowedOperation` y est appelée
   * **avant toute I/O réseau** : c'est le cœur de la contrainte lecture seule,
   * et aucune des méthodes publiques ci-dessous ne peut le contourner.
   */
  private async execute(
    model: AllowedModel,
    method: AllowedMethod,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ): Promise<unknown> {
    assertAllowedOperation(model, method);

    const body = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [env.ODOO_DB, env.ODOO_UID, env.ODOO_API_KEY, model, method, args, kwargs],
      },
      id: nextRequestId(),
    };

    return this.postWithRetries(body, model);
  }

  async searchRead(params: SearchReadParams): Promise<Record<string, unknown>[]> {
    const kwargs: Record<string, unknown> = {
      fields: params.fields,
      limit: params.limit,
    };
    if (params.offset !== undefined) {
      kwargs.offset = params.offset;
    }
    if (params.order !== undefined) {
      kwargs.order = params.order;
    }
    if (params.context !== undefined) {
      kwargs.context = params.context;
    }

    const result = await this.execute(params.model, params.method, [params.domain], kwargs);
    return asRecordArray(result, params.model, params.method);
  }

  /**
   * Nombre total d'enregistrements correspondant au domaine, indépendamment de
   * toute pagination. C'est ce qui permet de répondre « combien ? » sans balayer.
   */
  async searchCount(params: SearchCountParams): Promise<number> {
    const kwargs: Record<string, unknown> = {};
    if (params.context !== undefined) {
      kwargs.context = params.context;
    }

    const result = await this.execute(params.model, 'search_count', [params.domain], kwargs);
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new OdooValidationError(
        `Réponse inattendue de search_count sur ${params.model} : un nombre était attendu.`,
      );
    }
    return result;
  }

  /**
   * Regroupement côté Odoo. `lazy: false` est **forcé** : sans lui, Odoo ne
   * développe que le premier axe de `groupby` et renvoie des sous-groupes à
   * dérouler, ce qui fausserait silencieusement tout regroupement multi-axes.
   */
  async readGroup(params: ReadGroupParams): Promise<Record<string, unknown>[]> {
    const kwargs: Record<string, unknown> = { lazy: false };
    if (params.limit !== undefined) kwargs.limit = params.limit;
    if (params.offset !== undefined) kwargs.offset = params.offset;
    if (params.orderby !== undefined) kwargs.orderby = params.orderby;
    if (params.context !== undefined) kwargs.context = params.context;

    const result = await this.execute(
      params.model,
      'read_group',
      [params.domain, params.fields, params.groupby],
      kwargs,
    );
    return asRecordArray(result, params.model, 'read_group');
  }

  private async postWithRetries(body: unknown, model: string): Promise<unknown> {
    let attempt = 0;
    // ODOO_HTTP_MAX_RETRIES tentatives supplémentaires, uniquement sur erreurs transitoires.
    for (;;) {
      try {
        const response = await this.http.post<JsonRpcResponse>('/jsonrpc', body);
        return this.unwrap(response.data);
      } catch (err) {
        if (this.isOdooTypedError(err)) {
          throw err; // erreurs applicatives : jamais de retry
        }
        if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
          logger.warn('Timeout appel Odoo', { model, uid: maskSecret(env.ODOO_UID) });
          throw new OdooTimeoutError();
        }
        const canRetry = isRetryableHttpError(err) && attempt < env.ODOO_HTTP_MAX_RETRIES;
        if (!canRetry) {
          logger.error('Odoo indisponible après tentatives', { model, attempt });
          throw new OdooUnavailableError();
        }
        const delay = env.ODOO_HTTP_RETRY_BASE_DELAY_MS * 2 ** attempt;
        logger.warn('Nouvel essai après erreur transitoire', { model, attempt, delay });
        await sleep(delay);
        attempt += 1;
      }
    }
  }

  private isOdooTypedError(
    err: unknown,
  ): err is OdooAuthorizationError | OdooValidationError | OdooJsonRpcError {
    return (
      err instanceof OdooAuthorizationError ||
      err instanceof OdooValidationError ||
      err instanceof OdooJsonRpcError
    );
  }

  private unwrap(data: JsonRpcResponse): unknown {
    if ('error' in data) {
      const { data: errData } = data.error;
      if (classifyAuthError(errData?.name)) {
        throw new OdooAuthorizationError(errData?.message);
      }
      if (classifyValidationError(errData?.name)) {
        throw new OdooValidationError(errData?.message);
      }
      // Ne jamais propager `debug` (traceback complet) au-delà du log serveur.
      logger.error('Erreur JSON-RPC Odoo', { name: errData?.name, debug: errData?.debug });
      throw new OdooJsonRpcError({
        name: errData?.name,
        message: errData?.message ?? data.error.message,
      });
    }
    return data.result;
  }
}

/**
 * `search_read` et `read_group` renvoient une liste d'enregistrements ; un
 * résultat d'une autre forme signale un contrat rompu côté Odoo et ne doit pas
 * être propagé tel quel aux mappers.
 */
function asRecordArray(result: unknown, model: string, method: string): Record<string, unknown>[] {
  if (result === undefined || result === null) {
    return [];
  }
  if (!Array.isArray(result)) {
    throw new OdooValidationError(
      `Réponse inattendue de ${method} sur ${model} : une liste d'enregistrements était attendue.`,
    );
  }
  return result as Record<string, unknown>[];
}

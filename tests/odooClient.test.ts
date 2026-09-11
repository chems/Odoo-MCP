import { describe, expect, it, vi } from 'vitest';
import { OdooClient } from '../src/clients/odooClient.js';
import {
  OdooAuthorizationError,
  OdooOperationNotAllowedError,
  OdooTimeoutError,
  OdooUnavailableError,
} from '../src/security/errors.js';
import { searchHelpdeskTicketMessages } from '../src/services/helpdeskService.js';

function makeHttpMock(post: (...args: unknown[]) => unknown) {
  return { post: vi.fn(post) } as unknown as import('axios').AxiosInstance;
}

const baseParams = {
  model: 'knowledge.article' as const,
  method: 'search_read' as const,
  domain: [],
  fields: ['id', 'name'],
  limit: 10,
};

describe('OdooClient', () => {
  it('rejette une erreur JSON-RPC AccessError avec une erreur typée', async () => {
    const http = makeHttpMock(() =>
      Promise.resolve({
        data: {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: 200,
            message: 'Odoo Server Error',
            data: { name: 'odoo.exceptions.AccessError', message: 'Accès refusé.' },
          },
        },
      }),
    );
    const client = new OdooClient(http);

    await expect(client.searchRead(baseParams)).rejects.toBeInstanceOf(OdooAuthorizationError);
  });

  it('convertit un timeout réseau en OdooTimeoutError sans retry', async () => {
    const postMock = vi.fn(() => Promise.reject({ isAxiosError: true, code: 'ECONNABORTED' }));
    const http = { post: postMock } as unknown as import('axios').AxiosInstance;
    const client = new OdooClient(http);

    await expect(client.searchRead(baseParams)).rejects.toBeInstanceOf(OdooTimeoutError);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('retry sur 5xx puis échoue avec OdooUnavailableError', async () => {
    const postMock = vi.fn(() =>
      Promise.reject({ isAxiosError: true, response: { status: 500 } }),
    );
    const http = { post: postMock } as unknown as import('axios').AxiosInstance;
    const client = new OdooClient(http);

    await expect(client.searchRead(baseParams)).rejects.toBeInstanceOf(OdooUnavailableError);
    // 1 essai initial + ODOO_HTTP_MAX_RETRIES (2 par défaut) = 3 appels.
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  it("n'émet aucun appel HTTP pour une opération non whitelistée", async () => {
    const postMock = vi.fn();
    const http = { post: postMock } as unknown as import('axios').AxiosInstance;
    const client = new OdooClient(http);

    await expect(
      client.searchRead({ ...baseParams, model: 'res.users' as never }),
    ).rejects.toBeInstanceOf(OdooOperationNotAllowedError);
    expect(postMock).not.toHaveBeenCalled();
  });

  // --- Garde de sécurité : aucune écriture ne doit franchir le client ---

  describe('garde lecture seule (avant tout appel réseau)', () => {
    it("refuse create/write/unlink sans émettre le moindre POST", async () => {
      const postMock = vi.fn();
      const http = { post: postMock } as unknown as import('axios').AxiosInstance;
      const client = new OdooClient(http);

      for (const method of ['create', 'write', 'unlink', 'copy', 'action_archive']) {
        await expect(
          client.searchRead({
            ...baseParams,
            model: 'helpdesk.ticket',
            method: method as never,
          }),
          method,
        ).rejects.toBeInstanceOf(OdooOperationNotAllowedError);
      }
      expect(postMock).not.toHaveBeenCalled();
    });

    it('refuse un agrégat sur un modèle qui ne le prévoit pas, sans POST', async () => {
      const postMock = vi.fn();
      const http = { post: postMock } as unknown as import('axios').AxiosInstance;
      const client = new OdooClient(http);

      await expect(
        client.readGroup({
          model: 'knowledge.article',
          domain: [],
          fields: ['id'],
          groupby: ['parent_id'],
        }),
      ).rejects.toBeInstanceOf(OdooOperationNotAllowedError);
      expect(postMock).not.toHaveBeenCalled();
    });
  });

  // --- Agrégats (lot 4) ---

  describe('searchCount', () => {
    it('renvoie le nombre brut que retourne Odoo', async () => {
      const http = makeHttpMock(() => Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: 602 } }));
      const client = new OdooClient(http);

      await expect(
        client.searchCount({ model: 'helpdesk.ticket', domain: [['team_id', '=', 27]] }),
      ).resolves.toBe(602);
    });

    it('envoie le domaine en argument positionnel unique', async () => {
      const postMock = vi.fn(() => Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: 0 } }));
      const http = { post: postMock } as unknown as import('axios').AxiosInstance;
      const client = new OdooClient(http);

      await client.searchCount({ model: 'helpdesk.ticket', domain: [['team_id', '=', 27]] });

      const body = postMock.mock.calls[0]![1] as {
        params: { args: unknown[] };
      };
      expect(body.params.args[4]).toBe('search_count');
      expect(body.params.args[5]).toEqual([[['team_id', '=', 27]]]);
    });

    it('refuse une réponse qui ne serait pas un nombre', async () => {
      const http = makeHttpMock(() => Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: [] } }));
      const client = new OdooClient(http);

      await expect(client.searchCount({ model: 'helpdesk.ticket', domain: [] })).rejects.toThrow(
        /un nombre était attendu/,
      );
    });
  });

  describe('readGroup', () => {
    it('force lazy:false et transmet le contexte de fuseau', async () => {
      const postMock = vi.fn(() => Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: [] } }));
      const http = { post: postMock } as unknown as import('axios').AxiosInstance;
      const client = new OdooClient(http);

      await client.readGroup({
        model: 'helpdesk.ticket',
        domain: [['team_id', '=', 27]],
        fields: ['id'],
        groupby: ['x_studio_produit', 'stage_id'],
        context: { tz: 'Europe/Brussels' },
        limit: 100,
      });

      const body = postMock.mock.calls[0]![1] as {
        params: { args: [string, number, string, string, string, unknown[], Record<string, unknown>] };
      };
      const [, , , model, method, args, kwargs] = body.params.args;
      expect(model).toBe('helpdesk.ticket');
      expect(method).toBe('read_group');
      // domain, fields, groupby — dans cet ordre.
      expect(args).toEqual([[['team_id', '=', 27]], ['id'], ['x_studio_produit', 'stage_id']]);
      // Sans lazy:false, Odoo ne développerait que le premier axe.
      expect(kwargs.lazy).toBe(false);
      expect(kwargs.context).toEqual({ tz: 'Europe/Brussels' });
      expect(kwargs.limit).toBe(100);
    });
  });

  describe('searchRead', () => {
    it('transmet order et context à Odoo', async () => {
      const postMock = vi.fn(() => Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: [] } }));
      const http = { post: postMock } as unknown as import('axios').AxiosInstance;
      const client = new OdooClient(http);

      await client.searchRead({
        ...baseParams,
        model: 'helpdesk.ticket',
        order: 'create_date desc, id desc',
      });

      const body = postMock.mock.calls[0]![1] as { params: { args: unknown[] } };
      const kwargs = body.params.args[6] as Record<string, unknown>;
      expect(kwargs.order).toBe('create_date desc, id desc');
    });

    it('tolère un résultat nul et refuse un résultat non tabulaire', async () => {
      const vide = new OdooClient(
        makeHttpMock(() => Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: null } })),
      );
      await expect(vide.searchRead(baseParams)).resolves.toEqual([]);

      const invalide = new OdooClient(
        makeHttpMock(() => Promise.resolve({ data: { jsonrpc: '2.0', id: 1, result: 42 } })),
      );
      await expect(invalide.searchRead(baseParams)).rejects.toThrow(/liste d'enregistrements/);
    });
  });

  it('lit l\'historique des messages du ticket 40882 via mail.message', async () => {
    const searchRead = vi.fn().mockResolvedValue([
      {
        id: 101,
        author_id: [12, 'Alice Dupont'],
        date: '2024-07-19 16:42:00',
        message_type: 'comment',
        subject: 'Réponse support',
        body: '<p>Bonjour, nous avons bien reçu votre ticket.</p>',
        model: 'helpdesk.ticket',
        res_id: 40882,
        record_name: 'Ticket 40882',
        attachment_ids: [[55, 'reponse.pdf']],
        subtype_id: [false, 'internal'],
        is_internal: false,
      },
      {
        id: 102,
        author_id: [7, 'Client'],
        date: '2024-07-19 17:03:00',
        message_type: 'email',
        subject: 'Nouvelle information',
        body: '<p>Voici un complément sur le problème.</p>',
        model: 'helpdesk.ticket',
        res_id: 40882,
        record_name: 'Ticket 40882',
        attachment_ids: [],
        subtype_id: [false, 'comment'],
        is_internal: false,
      },
    ]);
    const client = { searchRead } as unknown as OdooClient;

    const result = await searchHelpdeskTicketMessages(client, {
      ticketId: 40882,
      limit: 25,
      offset: 0,
    });

    expect(searchRead).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mail.message',
        method: 'search_read',
        domain: [
          ['model', '=', 'helpdesk.ticket'],
          ['res_id', '=', 40882],
        ],
        order: 'id asc',
      }),
    );

    expect(result).not.toHaveProperty('ticketId');
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      ticketId: 40882,
      authorId: 12,
      authorName: 'Alice Dupont',
      messageType: 'comment',
      attachmentIds: [55],
      isInternal: true,
    });
    expect(result.results[0].body).toBe('Bonjour, nous avons bien reçu votre ticket.');
    expect(result.results[1].authorName).toBe('Client');
    expect(result.hasMore).toBe(false);
  });

  it('ne laisse jamais fuiter ODOO_API_KEY dans un message d\'erreur', async () => {
    const http = makeHttpMock(() =>
      Promise.resolve({
        data: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: 200, message: 'Odoo Server Error', data: { name: 'Unknown', message: 'oops' } },
        },
      }),
    );
    const client = new OdooClient(http);

    try {
      await client.searchRead(baseParams);
      throw new Error('devrait avoir levé une erreur');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(process.env.ODOO_API_KEY);
    }
  });
});

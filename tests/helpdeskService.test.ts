import { describe, expect, it, vi } from 'vitest';
import { searchHelpdeskTickets } from '../src/services/helpdeskService.js';
import { SearchHelpdeskSchema } from '../src/schemas/helpdesk.js';
import type { OdooClient, SearchReadParams } from '../src/clients/odooClient.js';

const TICKET = {
  id: 41904,
  name: 'Horizon présences',
  create_date: '2026-09-02 09:08:02',
  write_date: '2026-09-02 09:27:01',
  stage_id: [4, 'Solved'],
  team_id: [27, 'Horizon Présences'],
  tag_ids: [6],
  priority: '0',
  x_studio_produit: 'Proeco5',
};

interface Calls {
  searchRead: SearchReadParams[];
}

function makeClient(total = 602, rows: Record<string, unknown>[] = [TICKET]) {
  const calls: Calls = { searchRead: [] };
  const client = {
    searchRead: vi.fn(async (params: SearchReadParams) => {
      calls.searchRead.push(params);
      if (params.model === 'helpdesk.tag') return [{ id: 6, name: 'Demande Assistance' }];
      if (params.model === 'mail.message') {
        return [
          { id: 900, date: '2026-09-02 09:10:00', body: '<p>plus ancien</p>', message_type: 'comment' },
          { id: 901, date: '2026-09-02 09:20:00', body: '<p>plus récent</p>', message_type: 'comment' },
        ];
      }
      return rows;
    }),
    searchCount: vi.fn(async () => total),
    readGroup: vi.fn(async () => []),
  } as unknown as OdooClient;
  return { client, calls };
}

const parse = (input: Record<string, unknown>) => SearchHelpdeskSchema.parse(input);

const ticketCalls = (calls: Calls) => calls.searchRead.filter((c) => c.model === 'helpdesk.ticket');
const messageCalls = (calls: Calls) => calls.searchRead.filter((c) => c.model === 'mail.message');

describe('searchHelpdeskTickets', () => {
  describe('tri déterministe (D2)', () => {
    it('transmet toujours un order, avec départage par id', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(client, parse({ teamId: 27 }));
      expect(ticketCalls(calls)[0]!.order).toBe('create_date desc, id desc');
    });

    it('respecte un order explicite de la liste blanche', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(client, parse({ teamId: 27, order: 'priority desc' }));
      expect(ticketCalls(calls)[0]!.order).toBe('priority desc, id desc');
    });

    it('ne réordonne plus la page par score de pertinence', async () => {
      const rows = [
        { ...TICKET, id: 3, name: 'sans rapport' },
        { ...TICKET, id: 2, name: 'budget budget budget' },
        { ...TICKET, id: 1, name: 'budget' },
      ];
      const { client } = makeClient(3, rows);
      const result = await searchHelpdeskTickets(client, parse({ query: 'budget' }));
      // L'ordre d'Odoo est préservé, même si le 2e est plus pertinent.
      expect(result.results.map((r) => r.id)).toEqual([3, 2, 1]);
      // Le score reste calculé et exposé : l'appelant peut trier lui-même.
      expect(result.results[1]!.relevanceScore).not.toBeNull();
    });
  });

  describe('query optionnel (D7)', () => {
    it('ne produit aucune clause ilike sans query', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(client, parse({ teamId: 27, lastDays: 30 }));
      const domain = JSON.stringify(ticketCalls(calls)[0]!.domain);
      expect(domain).not.toContain('ilike');
      expect(domain).toContain('team_id');
    });

    it('produit une clause ilike quand query est fourni', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(client, parse({ query: 'connexion' }));
      expect(JSON.stringify(ticketCalls(calls)[0]!.domain)).toContain('ilike');
    });
  });

  describe('bornes temporelles (D1)', () => {
    it('borne basse incluse et haute exclue dans le domaine', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(
        client,
        parse({ teamId: 27, createdAfter: '2026-08-01', createdBefore: '2026-09-01' }),
      );
      expect(ticketCalls(calls)[0]!.domain).toEqual([
        ['team_id', '=', 27],
        ['create_date', '>=', '2026-08-01 00:00:00'],
        ['create_date', '<', '2026-09-01 00:00:00'],
      ]);
    });

    it('expose la période résolue dans la réponse', async () => {
      const { client } = makeClient();
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27, lastDays: 30 }));
      expect(result.period.from).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(result.period.to).toBeNull();
    });
  });

  describe('total et pagination (D3)', () => {
    it('distingue count (page) de total (correspondances)', async () => {
      const { client } = makeClient(602);
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27 }));
      expect(result.count).toBe(1);
      expect(result.total).toBe(602);
    });

    it('calcule hasMore depuis le total, pas depuis la taille de la page', async () => {
      const { client } = makeClient(602);
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27, offset: 0 }));
      expect(result.hasMore).toBe(true);

      const { client: fin } = makeClient(1);
      expect((await searchHelpdeskTickets(fin, parse({ teamId: 27 }))).hasMore).toBe(false);
    });

    it('compte sur le même domaine que la recherche', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(client, parse({ teamId: 27, lastDays: 30 }));
      const searchCount = vi.mocked(client.searchCount);
      expect(searchCount.mock.calls[0]![0].domain).toEqual(ticketCalls(calls)[0]!.domain);
    });
  });

  describe('charge utile (D6)', () => {
    it("n'émet AUCUN appel mail.message par défaut", async () => {
      const { client, calls } = makeClient();
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27 }));
      expect(messageCalls(calls)).toHaveLength(0);
      // Les clés sont absentes de la sortie, pas seulement nulles : c'est ce qui
      // allège réellement la charge sérialisée.
      expect(result.results[0]).not.toHaveProperty('history');
      expect(result.results[0]).not.toHaveProperty('messages');
      expect(JSON.stringify(result.results[0])).not.toContain('history');
    });

    it('joint les messages seulement sur demande, du plus ancien au plus récent', async () => {
      const { client, calls } = makeClient();
      const result = await searchHelpdeskTickets(
        client,
        parse({ teamId: 27, includeMessages: true, messageLimit: 5 }),
      );
      expect(messageCalls(calls)).toHaveLength(1);
      expect(messageCalls(calls)[0]!.limit).toBe(5);
      // Récupérés en id desc, restitués chronologiquement.
      expect(messageCalls(calls)[0]!.order).toBe('id desc');
      expect(result.results[0]!.history!.map((m) => m.id)).toEqual([901, 900]);
    });
  });

  describe('catégories (D4)', () => {
    it('demande toujours le socle de champs, même avec fields: ["id"]', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(client, parse({ teamId: 27, fields: ['id'] }));
      const fields = ticketCalls(calls)[0]!.fields;
      expect(fields).toEqual(expect.arrayContaining(['id', 'team_id', 'tag_ids', 'x_studio_produit']));
    });

    it('résout les libellés des étiquettes en un seul appel pour toute la page', async () => {
      const rows = [
        { ...TICKET, id: 1, tag_ids: [6] },
        { ...TICKET, id: 2, tag_ids: [6] },
        { ...TICKET, id: 3, tag_ids: [6] },
      ];
      const { client, calls } = makeClient(3, rows);
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27 }));

      expect(calls.searchRead.filter((c) => c.model === 'helpdesk.tag')).toHaveLength(1);
      expect(result.results.every((r) => r.tags?.[0] === 'Demande Assistance')).toBe(true);
    });

    it("n'appelle pas helpdesk.tag quand aucun ticket n'a d'étiquette", async () => {
      const { client, calls } = makeClient(1, [{ ...TICKET, tag_ids: [] }]);
      await searchHelpdeskTickets(client, parse({ teamId: 27 }));
      expect(calls.searchRead.filter((c) => c.model === 'helpdesk.tag')).toHaveLength(0);
    });

    it('expose équipe et produit en sortie', async () => {
      const { client } = makeClient();
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27 }));
      expect(result.results[0]!.helpdesk?.team).toEqual({ id: 27, label: 'Horizon Présences' });
      expect(result.results[0]!.helpdesk?.product).toBe('Proeco5');
    });

    it('filtre sur le produit', async () => {
      const { client, calls } = makeClient();
      await searchHelpdeskTickets(client, parse({ teamId: 27, product: 'Proeco5' }));
      expect(ticketCalls(calls)[0]!.domain).toContainEqual(['x_studio_produit', '=', 'Proeco5']);
    });
  });

  describe('URL du ticket', () => {
    it('construit une URL absolue depuis access_url', async () => {
      const { client } = makeClient(1, [{ ...TICKET, access_url: '/my/ticket/41904' }]);
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27 }));
      expect(result.results[0]!.url).toMatch(/\/my\/ticket\/41904$/);
      expect(result.results[0]!.unavailableFields).not.toContain('url');
    });

    it("signale l'URL indisponible quand access_url est absent", async () => {
      const { client } = makeClient(1, [TICKET]);
      const result = await searchHelpdeskTickets(client, parse({ teamId: 27 }));
      expect(result.results[0]!.url).toBeNull();
      expect(result.results[0]!.unavailableFields).toContain('url');
    });

    it("ne laisse JAMAIS fuir access_token, même demandé explicitement", async () => {
      const { client, calls } = makeClient(1, [{ ...TICKET, access_url: '/my/ticket/41904' }]);
      const result = await searchHelpdeskTickets(
        client,
        parse({ teamId: 27, fields: ['id', 'access_token'] }),
      );
      // Ni demandé à Odoo…
      expect(ticketCalls(calls)[0]!.fields).not.toContain('access_token');
      // …ni présent dans la sortie sérialisée.
      expect(JSON.stringify(result.results)).not.toContain('access_token');
    });
  });

  describe('clarté de la sortie (D8 lot 8)', () => {
    it('distingue un champ non exposé d\'un champ inconnu d\'Odoo', async () => {
      const { client } = makeClient();
      const result = await searchHelpdeskTickets(
        client,
        parse({ teamId: 27, fields: ['id', 'access_token', 'ticket_type_id'] }),
      );

      expect(result.ignoredFields).toEqual(['access_token', 'ticket_type_id']);
      expect(result.ignoredFieldsDetail).toEqual([
        // Existe sur helpdesk.ticket, mais ce serveur ne l'expose jamais.
        { field: 'access_token', reason: 'non_expose' },
        // N'existe pas du tout sur ce modèle Odoo 18.
        { field: 'ticket_type_id', reason: 'inconnu' },
      ]);
    });
  });
});

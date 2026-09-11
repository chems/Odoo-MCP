import { describe, expect, it, vi } from 'vitest';
import {
  computeHelpdeskStats,
  extractGroupCount,
  listHelpdeskTeams,
  normalizeGroupKeyPart,
  normalizeGroupRow,
} from '../src/services/helpdeskStatsService.js';
import { HelpdeskStatsSchema, ListHelpdeskTeamsSchema } from '../src/schemas/helpdeskStats.js';
import type { OdooClient } from '../src/clients/odooClient.js';

function makeClient(overrides: Partial<Record<'searchRead' | 'searchCount' | 'readGroup', unknown>>) {
  return {
    searchRead: vi.fn(async () => []),
    searchCount: vi.fn(async () => 0),
    readGroup: vi.fn(async () => []),
    ...overrides,
  } as unknown as OdooClient;
}

const parse = (input: Record<string, unknown>) => HelpdeskStatsSchema.parse(input);

describe('normalisation des lignes read_group', () => {
  it('lit __count', () => {
    expect(extractGroupCount({ __count: 246 }, ['tag_ids'])).toBe(246);
  });

  it('retombe sur <champ>_count quand __count est absent', () => {
    expect(extractGroupCount({ team_id_count: 602 }, ['team_id'])).toBe(602);
    // Le repli tient compte du suffixe de granularité.
    expect(extractGroupCount({ create_date_count: 19 }, ['create_date:day'])).toBe(19);
  });

  it('renvoie 0 plutôt que NaN si aucun compteur n\'est présent', () => {
    expect(extractGroupCount({}, ['team_id'])).toBe(0);
  });

  it('normalise un many2one [id, libellé]', () => {
    expect(normalizeGroupKeyPart('team_id', [27, 'Horizon Présences'])).toEqual({
      field: 'team_id',
      id: 27,
      label: 'Horizon Présences',
    });
  });

  it('normalise une sélection ou une date déjà formatée', () => {
    expect(normalizeGroupKeyPart('x_studio_produit', 'Proeco5')).toEqual({
      field: 'x_studio_produit',
      id: null,
      label: 'Proeco5',
    });
    expect(normalizeGroupKeyPart('create_date:day', '01 sept. 2026')).toEqual({
      field: 'create_date:day',
      id: null,
      label: '01 sept. 2026',
    });
  });

  it('normalise un champ vide (false) en libellé null', () => {
    expect(normalizeGroupKeyPart('x_studio_produit', false)).toEqual({
      field: 'x_studio_produit',
      id: null,
      label: null,
    });
  });

  it('aplatit une ligne croisée multi-axes', () => {
    const row = { stage_id: [4, 'Solved'], x_studio_produit: 'Proeco5', __count: 12 };
    expect(normalizeGroupRow(row, ['stage_id', 'x_studio_produit'])).toEqual({
      key: [
        { field: 'stage_id', id: 4, label: 'Solved' },
        { field: 'x_studio_produit', id: null, label: 'Proeco5' },
      ],
      count: 12,
    });
  });
});

describe('computeHelpdeskStats', () => {
  it('prend le total de search_count, jamais de la somme des groupes', async () => {
    const client = makeClient({
      searchCount: vi.fn(async () => 602),
      // Somme volontairement différente : le total ne doit pas en dépendre.
      readGroup: vi.fn(async () => [
        { x_studio_produit: 'Proeco5', __count: 261 },
        { x_studio_produit: false, __count: 316 },
      ]),
    });

    const stats = await computeHelpdeskStats(
      client,
      parse({ groupBy: ['x_studio_produit'], teamId: 27, lastDays: 30 }),
    );

    expect(stats.total).toBe(602);
    expect(stats.sumOfGroups).toBe(577);
    expect(stats.groupCount).toBe(2);
    expect(stats.warnings.some((w) => w.includes('diffère du total'))).toBe(true);
  });

  it('force lazy:false et transmet le fuseau à read_group', async () => {
    const readGroup = vi.fn(async () => []);
    const client = makeClient({ readGroup, searchCount: vi.fn(async () => 0) });

    await computeHelpdeskStats(client, parse({ groupBy: ['create_date:day'], lastDays: 7 }));

    const call = readGroup.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.context).toEqual({ tz: 'Europe/Brussels' });
    expect(call.groupby).toEqual(['create_date:day']);
    expect(call.model).toBe('helpdesk.ticket');
  });

  it('applique la période et les filtres au domaine des DEUX appels', async () => {
    const readGroup = vi.fn(async () => []);
    const searchCount = vi.fn(async () => 0);
    const client = makeClient({ readGroup, searchCount });

    await computeHelpdeskStats(
      client,
      parse({ groupBy: ['team_id'], teamId: 27, createdAfter: '2026-08-01', createdBefore: '2026-09-01' }),
    );

    const domaineGroupes = (readGroup.mock.calls[0]![0] as { domain: unknown[] }).domain;
    const domaineTotal = (searchCount.mock.calls[0]![0] as { domain: unknown[] }).domain;
    expect(domaineGroupes).toEqual(domaineTotal);
    expect(domaineTotal).toEqual([
      ['team_id', '=', 27],
      ['create_date', '>=', '2026-08-01 00:00:00'],
      ['create_date', '<', '2026-09-01 00:00:00'],
    ]);
  });

  it('avertit sur un axe multivalué', async () => {
    const client = makeClient({
      searchCount: vi.fn(async () => 602),
      readGroup: vi.fn(async () => [
        { tag_ids: [6, 'Demande Assistance'], __count: 246 },
        { tag_ids: false, __count: 356 },
      ]),
    });

    const stats = await computeHelpdeskStats(client, parse({ groupBy: ['tag_ids'], teamId: 27, lastDays: 30 }));

    expect(stats.warnings.some((w) => w.includes('multivalué'))).toBe(true);
    // En Odoo 18, les tickets sans étiquette forment bien un groupe (libellé null).
    expect(stats.groups[1]!.key[0]!.label).toBeNull();
    expect(stats.sumOfGroups).toBe(602);
  });

  it('avertit quand le résultat est tronqué à la limite de groupes', async () => {
    const client = makeClient({
      searchCount: vi.fn(async () => 999),
      readGroup: vi.fn(async () => [{ partner_id: [1, 'A'], __count: 1 }, { partner_id: [2, 'B'], __count: 1 }]),
    });

    const stats = await computeHelpdeskStats(client, parse({ groupBy: ['partner_id'], limit: 2 }));
    expect(stats.warnings.some((w) => w.includes('tronqué'))).toBe(true);
  });

  it('avertit sur le fuseau dès qu\'un axe est une date', async () => {
    const client = makeClient({ searchCount: vi.fn(async () => 1), readGroup: vi.fn(async () => []) });
    const stats = await computeHelpdeskStats(client, parse({ groupBy: ['create_date:month'] }));
    expect(stats.warnings.some((w) => w.includes('Europe/Brussels'))).toBe(true);
  });

  it('propage le refus d\'une période vide', async () => {
    const client = makeClient({});
    await expect(
      computeHelpdeskStats(
        client,
        parse({ groupBy: ['team_id'], createdAfter: '2026-09-01', createdBefore: '2026-08-01' }),
      ),
    ).rejects.toThrow(/Période vide/);
  });
});

describe('listHelpdeskTeams', () => {
  it('relie un identifiant à un nom d\'équipe (D5)', async () => {
    const client = makeClient({
      searchRead: vi.fn(async () => [
        { id: 27, name: 'Horizon Présences', company_id: [1, 'ASBL Scolares'], active: true },
      ]),
    });

    const result = await listHelpdeskTeams(client, ListHelpdeskTeamsSchema.parse({}));

    expect(result.results).toEqual([
      { id: 27, name: 'Horizon Présences', companyId: 1, companyName: 'ASBL Scolares', active: true },
    ]);
    expect(result.ticketCountPeriod).toBeNull();
  });

  it('compte les tickets par un unique read_group, pas un search_count par équipe', async () => {
    const readGroup = vi.fn(async () => [
      { team_id: [27, 'Horizon Présences'], __count: 602 },
      { team_id: [3, 'Support'], __count: 1683 },
    ]);
    const searchCount = vi.fn(async () => 0);
    const client = makeClient({
      searchRead: vi.fn(async () => [
        { id: 27, name: 'Horizon Présences', company_id: [1, 'ASBL Scolares'], active: true },
        { id: 3, name: 'Support', company_id: [1, 'ASBL Scolares'], active: true },
        { id: 9, name: 'Itslearning', company_id: [1, 'ASBL Scolares'], active: true },
      ]),
      readGroup,
      searchCount,
    });

    const result = await listHelpdeskTeams(
      client,
      ListHelpdeskTeamsSchema.parse({ includeTicketCount: true, ticketCountLastDays: 30 }),
    );

    expect(readGroup).toHaveBeenCalledTimes(1);
    expect(searchCount).not.toHaveBeenCalled();
    expect(result.results.map((t) => t.ticketCount)).toEqual([602, 1683, 0]);
    expect(result.ticketCountPeriod?.to).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { searchAll } from '../src/services/crossSearchService.js';
import { OdooAuthorizationError } from '../src/security/errors.js';
import type { OdooClient, SearchReadParams } from '../src/clients/odooClient.js';

function makeClient(behavior: (params: SearchReadParams) => Record<string, unknown>[]) {
  return {
    searchRead: vi.fn(async (params: SearchReadParams) => behavior(params)),
    searchCount: vi.fn(async () => 1),
  } as unknown as OdooClient;
}

const baseParams = { query: 'budget', limit: 10, includeRelations: true, mode: 'text' as const };

describe('crossSearchService.searchAll (tool orchestration)', () => {
  it('fusionne les résultats quand les deux sources réussissent', async () => {
    const client = makeClient((params) =>
      params.model === 'knowledge.article'
        ? [{ id: 1, name: 'Article budget' }]
        : [{ id: 2, name: 'Ticket budget' }],
    );

    const result = await searchAll(client, baseParams);

    expect(result.errors).toEqual([]);
    expect(result.results).toHaveLength(2);
    expect(result.results.some((r) => r.source === 'knowledge')).toBe(true);
    expect(result.results.some((r) => r.source === 'helpdesk')).toBe(true);
  });

  it('renvoie des résultats partiels si une seule source échoue', async () => {
    const client = {
      searchRead: vi.fn(async (params: SearchReadParams) => {
        if (params.model === 'knowledge.article') {
          throw new OdooAuthorizationError('Accès refusé sur knowledge.article');
        }
        return [{ id: 2, name: 'Ticket budget' }];
      }),
      searchCount: vi.fn(async () => 1),
    } as unknown as OdooClient;

    const result = await searchAll(client, baseParams);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.source).toBe('knowledge');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.source).toBe('helpdesk');
  });

  it('renvoie une liste vide + 2 erreurs si les deux sources échouent (le tool agrège ensuite)', async () => {
    const client = {
      searchRead: vi.fn(async () => {
        throw new OdooAuthorizationError('Accès refusé');
      }),
      searchCount: vi.fn(async () => {
        throw new OdooAuthorizationError('Accès refusé');
      }),
    } as unknown as OdooClient;

    const result = await searchAll(client, baseParams);

    expect(result.errors).toHaveLength(2);
    expect(result.results).toHaveLength(0);
  });
});

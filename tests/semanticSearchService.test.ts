import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchSemantic } from '../src/services/semanticSearchService.js';
import { VectorStore } from '../src/embeddings/vectorStore.js';
import type { EmbeddingProvider } from '../src/embeddings/provider.js';
import type { OdooClient, SearchReadParams } from '../src/clients/odooClient.js';
import { mapHelpdeskTicketToNormalized } from '../src/mappers/helpdeskMapper.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-search-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeProvider(vectorsByText: Record<string, number[]>): EmbeddingProvider {
  return {
    modelId: 'fake-model',
    dimensions: 2,
    async embed(texts: string[]) {
      return texts.map((text) => Float32Array.from(vectorsByText[text] ?? [0, 0]));
    },
  };
}

function makeClient(rows: Record<string, unknown>[]): OdooClient {
  return {
    searchRead: vi.fn(async (_params: SearchReadParams) => rows),
  } as unknown as OdooClient;
}

describe('searchSemantic', () => {
  it('retourne cacheStatus "missing" et aucun résultat si le cache est vide', async () => {
    const store = new VectorStore(dir, 'helpdesk.ticket', 2);
    store.load();
    const provider = makeProvider({});
    const client = makeClient([]);

    const result = await searchSemantic(
      client,
      'helpdesk.ticket',
      'connexion',
      { limit: 5, filterDomain: [], fields: ['id', 'name'] },
      provider,
      store,
      mapHelpdeskTicketToNormalized,
    );

    expect(result.cacheStatus.state).toBe('missing');
    expect(result.results).toEqual([]);
  });

  it('classe les candidats par similarité cosinus décroissante et re-fetch les champs à jour', async () => {
    const store = new VectorStore(dir, 'helpdesk.ticket', 2);
    store.load();
    // vecteur 1 : proche de la requête ; vecteur 2 : orthogonal (similarité ~0)
    store.upsert(1, Float32Array.from([1, 0]), '2026-01-01 00:00:00', 'h1');
    store.upsert(2, Float32Array.from([0, 1]), '2026-01-01 00:00:00', 'h2');
    store.setCheckpoint(new Date().toISOString());
    store.save();

    const provider = makeProvider({ connexion: [1, 0] });
    const client = makeClient([{ id: 1, name: 'Ticket proche' }]);

    const result = await searchSemantic(
      client,
      'helpdesk.ticket',
      'connexion',
      { limit: 5, filterDomain: [], fields: ['id', 'name'] },
      provider,
      store,
      mapHelpdeskTicketToNormalized,
    );

    expect(result.cacheStatus.state).toBe('fresh');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id).toBe(1);
    expect(result.results[0]!.relevanceScore).toBeCloseTo(1);
    expect(result.results[0]!.relevanceReason).toContain('similarité sémantique cosinus');
  });

  it('ne garde aucun candidat sous le seuil SEMANTIC_MIN_SCORE (0.35 par défaut)', async () => {
    const store = new VectorStore(dir, 'helpdesk.ticket', 2);
    store.load();
    store.upsert(1, Float32Array.from([0, 1]), '2026-01-01 00:00:00', 'h1'); // orthogonal à la requête
    store.save();

    const provider = makeProvider({ connexion: [1, 0] });
    const client = makeClient([]);

    const result = await searchSemantic(
      client,
      'helpdesk.ticket',
      'connexion',
      { limit: 5, filterDomain: [], fields: ['id', 'name'] },
      provider,
      store,
      mapHelpdeskTicketToNormalized,
    );

    expect(result.results).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

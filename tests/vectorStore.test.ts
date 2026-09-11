import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VectorStore } from '../src/embeddings/vectorStore.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-store-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function vec(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe('VectorStore', () => {
  it('upsert puis getVector retrouve le même vecteur (roundtrip binaire)', () => {
    const store = new VectorStore(dir, 'knowledge.article', 3);
    store.load();
    store.upsert(1, vec(0.1, 0.2, 0.3), '2026-01-01 00:00:00', 'hash1');
    store.save();

    const reloaded = new VectorStore(dir, 'knowledge.article', 3);
    reloaded.load();
    const vector = reloaded.getVector(1);
    expect(vector).not.toBeNull();
    expect(Array.from(vector!)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
  });

  it('upsert sur un id existant écrase le vecteur au même slot', () => {
    const store = new VectorStore(dir, 'helpdesk.ticket', 2);
    store.load();
    store.upsert(5, vec(1, 0), '2026-01-01 00:00:00', 'a');
    store.upsert(5, vec(0, 1), '2026-01-02 00:00:00', 'b');
    store.save();

    expect(store.meta.count).toBe(1);
    expect(Array.from(store.getVector(5)!)).toEqual([0, 1]);
    expect(store.getEntryMeta(5)?.textHash).toBe('b');
  });

  it('prune retire les ids absents du set live et retourne le nombre supprimé', () => {
    const store = new VectorStore(dir, 'helpdesk.ticket', 1);
    store.load();
    store.upsert(1, vec(1), '2026-01-01', 'a');
    store.upsert(2, vec(2), '2026-01-01', 'b');
    store.upsert(3, vec(3), '2026-01-01', 'c');

    const removed = store.prune(new Set([1, 3]));

    expect(removed).toBe(1);
    expect(store.getVector(2)).toBeNull();
    expect(store.getVector(1)).not.toBeNull();
  });

  it('getVector retourne null pour un id jamais indexé', () => {
    const store = new VectorStore(dir, 'knowledge.article', 3);
    store.load();
    expect(store.getVector(999)).toBeNull();
  });

  it('setCheckpoint ne recule jamais la date déjà enregistrée', () => {
    const store = new VectorStore(dir, 'knowledge.article', 1);
    store.load();
    store.setCheckpoint('2026-01-05 00:00:00');
    store.setCheckpoint('2026-01-01 00:00:00');
    expect(store.meta.lastCheckpointWriteDate).toBe('2026-01-05 00:00:00');
  });
});

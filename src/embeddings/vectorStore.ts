import fs from 'node:fs';
import path from 'node:path';
import type { AllowedModel } from '../security/whitelist.js';

export interface VectorEntry {
  id: number;
  writeDate: string;
  textHash: string;
}

interface IndexEntry extends VectorEntry {
  slot: number;
}

interface IndexFile {
  modelId: string;
  dim: number;
  entries: Record<string, IndexEntry>;
  nextSlot: number;
  lastCheckpointWriteDate: string | null;
  lastFullReconcileAt: string | null;
}

function emptyIndex(dim: number): IndexFile {
  return { modelId: '', dim, entries: {}, nextSlot: 0, lastCheckpointWriteDate: null, lastFullReconcileAt: null };
}

/**
 * Cache vectoriel local persistant : un fichier binaire à stride fixe
 * (`<model>.vectors.bin`, un `Float32Array` de taille `dim` par slot,
 * adressage direct par `slot*dim*4` octets) plus un sidecar JSON
 * (`<model>.index.json`, id Odoo -> slot/writeDate/hash + checkpoints).
 * Évite toute dépendance native (better-sqlite3) ou moteur SQL embarqué
 * (sql.js) pour un besoin qui se réduit à un lookup id -> vecteur fixe.
 */
export class VectorStore {
  private readonly binPath: string;
  private readonly indexPath: string;
  private index: IndexFile;

  constructor(
    private readonly dir: string,
    private readonly model: AllowedModel,
    private readonly dim: number,
  ) {
    this.binPath = path.join(dir, `${model}.vectors.bin`);
    this.indexPath = path.join(dir, `${model}.index.json`);
    this.index = emptyIndex(dim);
  }

  load(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.indexPath)) {
      this.index = emptyIndex(this.dim);
      return;
    }
    const raw = fs.readFileSync(this.indexPath, 'utf8');
    this.index = JSON.parse(raw) as IndexFile;
  }

  save(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index), 'utf8');
  }

  upsert(id: number, vector: Float32Array, writeDate: string, textHash: string): void {
    if (vector.length !== this.dim) {
      throw new Error(`Dimension de vecteur inattendue: attendu ${this.dim}, reçu ${vector.length}`);
    }
    const key = String(id);
    const existing = this.index.entries[key];
    const slot = existing ? existing.slot : this.index.nextSlot;
    if (!existing) {
      this.index.nextSlot += 1;
    }
    this.writeVectorAtSlot(slot, vector);
    this.index.entries[key] = { id, writeDate, textHash, slot };
  }

  getVector(id: number): Float32Array | null {
    const entry = this.index.entries[String(id)];
    if (!entry) return null;
    return this.readVectorAtSlot(entry.slot);
  }

  getEntryMeta(id: number): VectorEntry | null {
    const entry = this.index.entries[String(id)];
    return entry ? { id: entry.id, writeDate: entry.writeDate, textHash: entry.textHash } : null;
  }

  allEntries(): VectorEntry[] {
    return Object.values(this.index.entries).map(({ id, writeDate, textHash }) => ({ id, writeDate, textHash }));
  }

  /** Charge tous les vecteurs en mémoire pour un scan par similarité cosinus. */
  allVectors(): Array<{ id: number; vector: Float32Array }> {
    return Object.values(this.index.entries).map((entry) => ({
      id: entry.id,
      vector: this.readVectorAtSlot(entry.slot),
    }));
  }

  prune(liveIds: ReadonlySet<number>): number {
    let removed = 0;
    for (const key of Object.keys(this.index.entries)) {
      const entry = this.index.entries[key];
      if (!entry) continue;
      if (!liveIds.has(entry.id)) {
        delete this.index.entries[key];
        removed += 1;
      }
    }
    return removed;
  }

  setCheckpoint(writeDate: string): void {
    if (!this.index.lastCheckpointWriteDate || writeDate > this.index.lastCheckpointWriteDate) {
      this.index.lastCheckpointWriteDate = writeDate;
    }
  }

  markFullReconcile(atIso: string): void {
    this.index.lastFullReconcileAt = atIso;
  }

  get meta(): { lastCheckpointWriteDate: string | null; lastFullReconcileAt: string | null; count: number } {
    return {
      lastCheckpointWriteDate: this.index.lastCheckpointWriteDate,
      lastFullReconcileAt: this.index.lastFullReconcileAt,
      count: Object.keys(this.index.entries).length,
    };
  }

  private get stride(): number {
    return this.dim * Float32Array.BYTES_PER_ELEMENT;
  }

  private writeVectorAtSlot(slot: number, vector: Float32Array): void {
    const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    const fd = fs.openSync(this.binPath, fs.existsSync(this.binPath) ? 'r+' : 'w');
    try {
      fs.writeSync(fd, buffer, 0, buffer.length, slot * this.stride);
    } finally {
      fs.closeSync(fd);
    }
  }

  private readVectorAtSlot(slot: number): Float32Array {
    const buffer = Buffer.alloc(this.stride);
    const fd = fs.openSync(this.binPath, 'r');
    try {
      fs.readSync(fd, buffer, 0, this.stride, slot * this.stride);
    } finally {
      fs.closeSync(fd);
    }
    return new Float32Array(buffer.buffer, buffer.byteOffset, this.dim);
  }
}

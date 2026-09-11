import { OdooClient } from '../clients/odooClient.js';
import { env } from '../config/env.js';
import { createLocalEmbeddingProvider, type EmbeddingProvider } from '../embeddings/provider.js';
import { VectorStore } from '../embeddings/vectorStore.js';
import { buildEmbeddingText, hashText } from '../embeddings/textPrep.js';
import { stripHtml } from '../utils/truncate.js';
import type { AllowedModel } from '../security/whitelist.js';

// Volontairement modeste : `body`/`description` peuvent contenir du HTML riche
// (tableaux, images en base64) ; une page de 500 lignes a déjà provoqué un
// MemoryError côté Odoo Online lors de la sérialisation JSON de la réponse.
const PAGE_SIZE = 40;
const EMBED_BATCH_SIZE = 16;
// Le scan de réconciliation ne récupère que `id` (léger) : page plus large.
const LIVE_ID_PAGE_SIZE = 1000;

interface ModelConfig {
  model: AllowedModel;
  contentField: string;
  cliName: string;
}

const MODEL_CONFIGS: ModelConfig[] = [
  { model: 'knowledge.article', contentField: 'body', cliName: 'knowledge' },
  { model: 'helpdesk.ticket', contentField: 'description', cliName: 'helpdesk' },
];

function parseArgs(): { full: boolean; modelFilter?: string } {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const modelArg = args.find((a) => a.startsWith('--model='));
  return { full, modelFilter: modelArg?.split('=')[1] };
}

async function fetchLiveIds(client: OdooClient, model: AllowedModel): Promise<Set<number>> {
  const liveIds = new Set<number>();
  let offset = 0;
  for (;;) {
    const rows = await client.searchRead({
      model,
      method: 'search_read',
      domain: [],
      fields: ['id'],
      limit: LIVE_ID_PAGE_SIZE,
      offset,
      order: 'id asc',
    });
    for (const row of rows) liveIds.add(row.id as number);
    if (rows.length < LIVE_ID_PAGE_SIZE) break;
    offset += LIVE_ID_PAGE_SIZE;
  }
  return liveIds;
}

async function indexModel(
  client: OdooClient,
  provider: EmbeddingProvider,
  config: ModelConfig,
  full: boolean,
): Promise<void> {
  const store = new VectorStore(env.EMBEDDING_CACHE_DIR, config.model, provider.dimensions);
  store.load();

  const checkpoint = full ? null : store.meta.lastCheckpointWriteDate;
  const domain: unknown[] = checkpoint ? [['write_date', '>', checkpoint]] : [];

  let offset = 0;
  let processed = 0;
  let embedded = 0;
  let maxWriteDate: string | null = null;

  for (;;) {
    const rows = await client.searchRead({
      model: config.model,
      method: 'search_read',
      domain,
      fields: ['id', 'name', config.contentField, 'write_date'],
      limit: PAGE_SIZE,
      offset,
      order: 'id asc',
    });
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
      const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
      const prepared = batch.map((row) => {
        const id = row.id as number;
        const writeDate = String(row.write_date);
        const title = typeof row.name === 'string' ? row.name : '';
        const content = stripHtml(row[config.contentField] as string | false | null | undefined);
        const text = buildEmbeddingText(title, content);
        const textHash = hashText(text);
        const existing = store.getEntryMeta(id);
        const unchanged = existing !== null && existing.writeDate === writeDate && existing.textHash === textHash;
        return { id, writeDate, text, textHash, unchanged };
      });

      const toEmbed = prepared.filter((p) => !p.unchanged);
      if (toEmbed.length > 0) {
        const vectors = await provider.embed(toEmbed.map((p) => p.text));
        toEmbed.forEach((p, idx) => {
          const vector = vectors[idx];
          if (vector) store.upsert(p.id, vector, p.writeDate, p.textHash);
        });
        embedded += toEmbed.length;
        store.save();
      }

      for (const p of prepared) {
        if (!maxWriteDate || p.writeDate > maxWriteDate) maxWriteDate = p.writeDate;
      }
      processed += batch.length;
      process.stdout.write(`\r[${config.cliName}] ${processed} vus, ${embedded} embarqués...`);
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (maxWriteDate) {
    store.setCheckpoint(maxWriteDate);
  }

  if (full) {
    process.stdout.write(`\n[${config.cliName}] réconciliation complète (élagage des ids supprimés)...\n`);
    const liveIds = await fetchLiveIds(client, config.model);
    const removed = store.prune(liveIds);
    store.markFullReconcile(new Date().toISOString());
    console.log(`[${config.cliName}] ${removed} entrée(s) élaguée(s).`);
  }

  store.save();
  console.log(`\n[${config.cliName}] terminé — ${store.meta.count} vecteur(s) en cache.`);
}

async function main(): Promise<void> {
  const { full, modelFilter } = parseArgs();
  if (modelFilter && !MODEL_CONFIGS.some((c) => c.cliName === modelFilter)) {
    console.error(`Modèle inconnu: "${modelFilter}" (attendu: knowledge|helpdesk)`);
    process.exit(1);
  }
  const configs = modelFilter ? MODEL_CONFIGS.filter((c) => c.cliName === modelFilter) : MODEL_CONFIGS;

  const client = new OdooClient();
  const provider = createLocalEmbeddingProvider();

  for (const config of configs) {
    console.log(`\n=== Indexation ${config.model} (${full ? 'complète' : 'incrémentale'}) ===`);
    await indexModel(client, provider, config, full);
  }
}

main().catch((err) => {
  console.error('Échec de la réindexation:', err);
  process.exit(1);
});

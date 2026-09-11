import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { env } from './config/env.js';
import { OdooClient } from './clients/odooClient.js';
import { registerSearchKnowledgeTool } from './tools/searchKnowledge.js';
import { registerSearchHelpdeskTool } from './tools/searchHelpdesk.js';
import { registerSearchAllTool } from './tools/searchAll.js';
import { registerHelpdeskStatsTools } from './tools/helpdeskStats.js';
import { registerContactTools } from './tools/contacts.js';
import { createLocalEmbeddingProvider } from './embeddings/provider.js';
import { VectorStore } from './embeddings/vectorStore.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const client = new OdooClient();

  // Le modèle ONNX ne se charge qu'au premier appel semantic/hybrid réel
  // (`createLocalEmbeddingProvider` est paresseux) ; charger l'index local ici
  // ne fait que lire un petit fichier JSON, pas de coût de démarrage notable.
  const provider = createLocalEmbeddingProvider();
  const knowledgeStore = new VectorStore(env.EMBEDDING_CACHE_DIR, 'knowledge.article', provider.dimensions);
  const helpdeskStore = new VectorStore(env.EMBEDDING_CACHE_DIR, 'helpdesk.ticket', provider.dimensions);
  knowledgeStore.load();
  helpdeskStore.load();

  const server = new McpServer({
    name: 'odoo-readonly-mcp',
    version: '1.0.0',
  });

  registerSearchKnowledgeTool(server, client, { provider, store: knowledgeStore });
  registerSearchHelpdeskTool(server, client, { provider, store: helpdeskStore });
  registerSearchAllTool(server, client, { provider, knowledgeStore, helpdeskStore });
  registerHelpdeskStatsTools(server, client);
  registerContactTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Serveur MCP Odoo (lecture seule) démarré', { baseUrl: env.ODOO_BASE_URL });
}

function shutdown(signal: string): void {
  logger.info(`Arrêt du serveur MCP (${signal})`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  logger.error('Échec du démarrage du serveur MCP', {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OdooClient } from '../clients/odooClient.js';
import { SearchKnowledgeSchema } from '../schemas/knowledge.js';
import { searchKnowledgeArticles, type SemanticDeps } from '../services/knowledgeService.js';
import { toMcpToolError } from '../security/errors.js';
import { logger } from '../utils/logger.js';

export function registerSearchKnowledgeTool(
  server: McpServer,
  client: OdooClient,
  semanticDeps?: SemanticDeps,
): void {
  server.registerTool(
    'search_knowledge',
    {
      title: 'Rechercher dans la Connaissance (Odoo)',
      description:
        "Recherche en lecture seule dans le module Connaissance d'Odoo (modèle knowledge.article, " +
        'méthode search_read uniquement). Recherche plein texte multi-mots (mode "text", défaut) sur le ' +
        'titre et le contenu, ou sémantique/hybride ("semantic"/"hybrid", nécessite `npm run reindex`), ' +
        'avec filtres optionnels (parentId, isPublished, isLocked) et pagination (limit/offset).',
      inputSchema: SearchKnowledgeSchema.shape,
    },
    async (rawArgs) => {
      const parsed = SearchKnowledgeSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Paramètres invalides: ${parsed.error.message}` }],
        };
      }

      try {
        const { results, ignoredFields, hasMore, modeLimitations } = await searchKnowledgeArticles(
          client,
          parsed.data,
          semanticDeps,
        );
        const envelope = {
          source: 'knowledge' as const,
          count: results.length,
          hasMore,
          ignoredFields,
          modeLimitations,
          results,
        };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      } catch (err) {
        const mcpError = toMcpToolError(err);
        logger.error('search_knowledge a échoué', { code: mcpError.code });
        return { isError: true, content: [{ type: 'text', text: `[${mcpError.code}] ${mcpError.message}` }] };
      }
    },
  );
}

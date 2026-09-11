import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OdooClient } from '../clients/odooClient.js';
import { SearchAllSchema } from '../schemas/searchAll.js';
import { searchAll, type SearchAllSemanticDeps } from '../services/crossSearchService.js';
import { logger } from '../utils/logger.js';

export function registerSearchAllTool(
  server: McpServer,
  client: OdooClient,
  semanticDeps?: SearchAllSemanticDeps,
): void {
  server.registerTool(
    'search_all',
    {
      title: 'Rechercher dans Connaissance + Assistance (Odoo)',
      description:
        'Recherche en lecture seule et en parallèle dans les modules Connaissance (knowledge.article) ' +
        "et Assistance (helpdesk.ticket) d'Odoo (search_read uniquement), fusionne les résultats, et " +
        'détecte des relations lexicales (recouvrement de mots-clés) entre articles et tickets. Supporte ' +
        'les modes "text"/"semantic"/"hybrid" (semantic/hybrid nécessitent `npm run reindex`). Renvoie des ' +
        "résultats partiels si l'un des deux modules échoue.",
      inputSchema: SearchAllSchema.shape,
    },
    async (rawArgs) => {
      const parsed = SearchAllSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Paramètres invalides: ${parsed.error.message}` }],
        };
      }

      const { results, errors, crossSearchLimitations, modeLimitations } = await searchAll(
        client,
        parsed.data,
        semanticDeps,
      );

      if (errors.length === 2) {
        logger.error('search_all: échec complet des deux sources', { errors });
        const aggregated = errors.map((e) => `${e.source}: ${e.error}`).join(' | ');
        return {
          isError: true,
          content: [{ type: 'text', text: `Les deux modules ont échoué — ${aggregated}` }],
        };
      }

      const envelope = {
        source: 'all' as const,
        count: results.length,
        errors,
        crossSearchLimitations,
        modeLimitations,
        results,
      };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    },
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OdooClient } from '../clients/odooClient.js';
import { HelpdeskStatsSchema, ListHelpdeskTeamsSchema } from '../schemas/helpdeskStats.js';
import { computeHelpdeskStats, listHelpdeskTeams } from '../services/helpdeskStatsService.js';
import { toMcpToolError } from '../security/errors.js';
import { logger } from '../utils/logger.js';

function asTextContent(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

export function registerHelpdeskStatsTools(server: McpServer, client: OdooClient): void {
  server.registerTool(
    'helpdesk_stats',
    {
      title: 'Compter et ventiler les tickets (Odoo)',
      description:
        "Compte et ventile les tickets d'Assistance Odoo en un seul appel, sans les récupérer " +
        '(lecture seule : search_count et read_group). Répond aux questions « combien » et ' +
        '« répartis par quoi » sur une période.\n' +
        '`total` vient toujours de search_count sur le domaine complet, jamais de la somme des ' +
        'groupes ; `sumOfGroups` est fourni à côté pour que tout écart soit visible.\n' +
        'Pour une ventilation « par catégorie » : ce modèle Odoo n\'a ni ticket_type_id ni ' +
        'category_id. Utilisez `x_studio_produit` (le champ « Produit », axe métier principal) ' +
        'ou `tag_ids` (les étiquettes). Attention : une part importante des tickets n\'est ' +
        'renseignée sur aucun des deux — le groupe au libellé null mesure exactement cette part.\n' +
        'Les bornes de période sont en UTC (Odoo stocke sans fuseau) ; les regroupements ' +
        'create_date:day/week/month suivent `timezone` (défaut Europe/Brussels).',
      inputSchema: HelpdeskStatsSchema.shape,
    },
    async (rawArgs) => {
      const parsed = HelpdeskStatsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          isError: true,
          content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)],
        };
      }

      try {
        const stats = await computeHelpdeskStats(client, parsed.data);
        return {
          content: [asTextContent(JSON.stringify({ source: 'helpdesk_stats', ...stats }, null, 2))],
        };
      } catch (err) {
        const mcpError = toMcpToolError(err);
        logger.error('helpdesk_stats a échoué', { code: mcpError.code });
        return { isError: true, content: [asTextContent(`[${mcpError.code}] ${mcpError.message}`)] };
      }
    },
  );

  server.registerTool(
    'list_helpdesk_teams',
    {
      title: "Lister les équipes d'Assistance (Odoo)",
      description:
        "Liste les équipes d'Assistance Odoo (helpdesk.team) avec leur identifiant et leur nom, " +
        'en lecture seule. À appeler pour relier un teamId à un nom d\'équipe avant toute ' +
        'recherche filtrée. `includeTicketCount` joint le nombre de tickets par équipe via un ' +
        'unique regroupement Odoo.',
      inputSchema: ListHelpdeskTeamsSchema.shape,
    },
    async (rawArgs) => {
      const parsed = ListHelpdeskTeamsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          isError: true,
          content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)],
        };
      }

      try {
        const teams = await listHelpdeskTeams(client, parsed.data);
        return {
          content: [asTextContent(JSON.stringify({ source: 'helpdesk_teams', ...teams }, null, 2))],
        };
      } catch (err) {
        const mcpError = toMcpToolError(err);
        logger.error('list_helpdesk_teams a échoué', { code: mcpError.code });
        return { isError: true, content: [asTextContent(`[${mcpError.code}] ${mcpError.message}`)] };
      }
    },
  );
}

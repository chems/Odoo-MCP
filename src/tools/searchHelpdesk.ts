import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OdooClient } from '../clients/odooClient.js';
import { GetHelpdeskTicketMessagesSchema, SearchHelpdeskSchema } from '../schemas/helpdesk.js';
import {
  searchHelpdeskTicketMessages,
  searchHelpdeskTickets,
  type SemanticDeps,
} from '../services/helpdeskService.js';
import { toMcpToolError } from '../security/errors.js';
import { logger } from '../utils/logger.js';

function asTextContent(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

export function registerSearchHelpdeskTool(
  server: McpServer,
  client: OdooClient,
  semanticDeps?: SemanticDeps,
): void {
  server.registerTool(
    'search_helpdesk',
    {
      title: 'Rechercher dans Assistance (Odoo)',
      description:
        "Recherche en lecture seule dans le module Assistance d'Odoo (modèle helpdesk.ticket). " +
        'Recherche plein texte multi-mots (mode "text", défaut) sur le titre et la description, ou ' +
        'sémantique/hybride ("semantic"/"hybrid", nécessite `npm run reindex`). `query` est ' +
        'facultatif : un filtre purement structuré suffit.\n' +
        'Filtres : teamId, stageId, partnerId, userId, product (x_studio_produit), et bornes ' +
        'temporelles createdAfter / createdBefore (exclue) / lastDays.\n' +
        'Dans la réponse, `count` est la taille de la page et `total` le nombre de tickets ' +
        'correspondant au filtre — ne pas confondre. Le tri est déterministe (défaut ' +
        '"create_date desc", départagé par id), donc la pagination ne duplique ni n\'omet.\n' +
        "Le fil de messages n'est PAS inclus par défaut (includeMessages: false) car il pèse de " +
        '700 à 6000 tokens par ticket ; pour lire un fil, utilisez get_helpdesk_ticket_messages. ' +
        'Pour compter ou ventiler sans récupérer les tickets, utilisez helpdesk_stats.',
      inputSchema: SearchHelpdeskSchema.shape,
    },
    async (rawArgs) => {
      const parsed = SearchHelpdeskSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          isError: true,
          content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)],
        };
      }

      try {
        const search = await searchHelpdeskTickets(client, parsed.data, semanticDeps);
        const envelope = {
          source: 'helpdesk' as const,
          /** Taille de la page renvoyée. */
          count: search.count,
          /** Tickets correspondant au filtre, toutes pages confondues. */
          total: search.total,
          hasMore: search.hasMore,
          offset: parsed.data.offset,
          order: search.order,
          period: search.period,
          ignoredFields: search.ignoredFields,
          ignoredFieldsDetail: search.ignoredFieldsDetail,
          modeLimitations: search.modeLimitations,
          results: search.results,
        };
        // JSON compact : l'indentation représentait 14 % de la charge sur une page
      // de 50 tickets, pour aucun gain de lisibilité côté appelant.
      return { content: [asTextContent(JSON.stringify(envelope))] };
      } catch (err) {
        const mcpError = toMcpToolError(err);
        logger.error('search_helpdesk a échoué', { code: mcpError.code });
        return { isError: true, content: [asTextContent(`[${mcpError.code}] ${mcpError.message}`)] };
      }
    },
  );

  const ticketMessagesToolConfig = {
    title: 'Historique des messages d’un ticket Helpdesk',
    description:
      'Retourne l’historique complet en lecture seule des messages associés à un ticket Helpdesk via le modèle Odoo mail.message. ' +
      'N’expose que des opérations search_read et ne renvoie que les messages/échanges du ticket demandé.',
    inputSchema: GetHelpdeskTicketMessagesSchema.shape,
  };

  const handleTicketMessages = async (rawArgs: unknown) => {
    const parsed = GetHelpdeskTicketMessagesSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        isError: true,
        content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)],
      };
    }

    try {
      const { results, ignoredFields, ignoredFieldsDetail, hasMore } =
        await searchHelpdeskTicketMessages(client, parsed.data);
      const envelope = {
        ticketId: parsed.data.ticketId,
        count: results.length,
        hasMore,
        ignoredFields,
        ignoredFieldsDetail,
        results,
      };
      // JSON compact : l'indentation représentait 14 % de la charge sur une page
      // de 50 tickets, pour aucun gain de lisibilité côté appelant.
      return { content: [asTextContent(JSON.stringify(envelope))] };
    } catch (err) {
      const mcpError = toMcpToolError(err);
      logger.error('get_helpdesk_ticket_messages a échoué', { code: mcpError.code, ticketId: parsed.data.ticketId });
      return { isError: true, content: [asTextContent(`[${mcpError.code}] ${mcpError.message}`)] };
    }
  };

  server.registerTool('get_helpdesk_ticket_messages', ticketMessagesToolConfig, handleTicketMessages);
  server.registerTool('search_helpdesk_messages', ticketMessagesToolConfig, handleTicketMessages);
}

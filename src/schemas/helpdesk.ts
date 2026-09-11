import { z } from 'zod';
import { BaseQuerySchema } from './common.js';
import { DEFAULT_HELPDESK_ORDER, HELPDESK_ORDER_VALUES } from '../utils/order.js';

/** Bornes temporelles, partagées par `search_helpdesk` et `helpdesk_stats`. */
export const DateRangeShape = {
  createdAfter: z
    .string()
    .optional()
    .describe('Borne basse incluse : "YYYY-MM-DD" (minuit UTC) ou ISO 8601 complet.'),
  createdBefore: z
    .string()
    .optional()
    .describe('Borne haute EXCLUE : "YYYY-MM-DD" (minuit UTC) ou ISO 8601 complet.'),
  lastDays: z
    .number()
    .int()
    .positive()
    .max(3650)
    .optional()
    .describe('Fenêtre glissante en jours. Exclusif de createdAfter/createdBefore.'),
};

export const SearchHelpdeskSchema = BaseQuerySchema.extend({
  // `query` devient optionnel : un filtre purement structuré (équipe + période)
  // ne doit plus obliger à inventer une recherche plein texte.
  query: z
    .string()
    .trim()
    .min(1, 'query ne peut pas être vide')
    .max(200)
    .optional()
    .describe('Recherche plein texte sur le titre et la description. Facultatif.'),

  order: z
    .enum(HELPDESK_ORDER_VALUES as unknown as [string, ...string[]])
    .default(DEFAULT_HELPDESK_ORDER)
    .describe(
      `Tri Odoo. Défaut "${DEFAULT_HELPDESK_ORDER}". Un départage par "id desc" est ajouté ` +
        'automatiquement pour rendre la pagination déterministe.',
    ),

  teamId: z.number().int().positive().optional(),
  stageId: z.number().int().positive().optional(),
  partnerId: z.number().int().positive().optional(),
  userId: z.number().int().positive().optional(),
  product: z
    .string()
    .min(1)
    .optional()
    .describe('Filtre sur x_studio_produit (ex. "Proeco5", "Horizon Présences").'),

  ...DateRangeShape,

  includeMessages: z
    .boolean()
    .default(false)
    .describe(
      "Joindre le fil de messages de chaque ticket. Faux par défaut : le fil pèse de 700 à " +
        '6000 tokens par ticket. Pour un seul ticket, préférez get_helpdesk_ticket_messages.',
    ),
  messageLimit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Nombre de messages les plus récents joints par ticket si includeMessages est vrai.'),
});

export const GetHelpdeskTicketMessagesSchema = z.object({
  ticketId: z.number().int().positive(),
  fields: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).default(50),
  offset: z.number().int().min(0).default(0),
});

export type SearchHelpdeskParams = z.infer<typeof SearchHelpdeskSchema>;
export type GetHelpdeskTicketMessagesParams = z.infer<typeof GetHelpdeskTicketMessagesSchema>;

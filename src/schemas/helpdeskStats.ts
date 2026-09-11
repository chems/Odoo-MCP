import { z } from 'zod';
import { DateRangeShape } from './helpdesk.js';

/**
 * Axes de regroupement autorisés, tous vérifiés présents sur `helpdesk.ticket`
 * (Odoo 18.0 Enterprise — voir `DIAGNOSTIC-D8.md`).
 *
 * Le modèle n'a **ni `ticket_type_id` ni `category_id`** : la catégorisation
 * métier de Scolares passe par `x_studio_produit` (« Produit ») et,
 * secondairement, par `tag_ids`.
 */
export const GROUP_BY_FIELDS = [
  'team_id',
  'stage_id',
  'user_id',
  'partner_id',
  'priority',
  'kanban_state',
  'tag_ids',
  'x_studio_produit',
  'x_studio_fonction',
  'create_date:day',
  'create_date:week',
  'create_date:month',
] as const;

export type GroupByField = (typeof GROUP_BY_FIELDS)[number];

/** Axe multivalué : un ticket peut compter dans plusieurs groupes. */
export const MULTIVALUED_GROUP_BY: readonly string[] = ['tag_ids'];

export const HelpdeskStatsSchema = z.object({
  groupBy: z
    .array(z.enum(GROUP_BY_FIELDS))
    .min(1)
    .max(3)
    .describe(
      'Axes de regroupement, 1 à 3. Pour une ventilation « par catégorie », utilisez ' +
        'x_studio_produit (le Produit) ou tag_ids (les étiquettes) : ce modèle Odoo n\'a pas ' +
        'de champ ticket_type_id.',
    ),

  teamId: z.number().int().positive().optional(),
  stageId: z.number().int().positive().optional(),
  partnerId: z.number().int().positive().optional(),
  userId: z.number().int().positive().optional(),
  product: z.string().min(1).optional().describe('Filtre sur x_studio_produit.'),
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Recherche plein texte sur le titre et la description, appliquée avant regroupement.'),

  ...DateRangeShape,

  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Nombre maximum de GROUPES retournés (pas de tickets).'),

  timezone: z
    .string()
    .min(1)
    .default('Europe/Brussels')
    .describe(
      'Fuseau appliqué aux seuls regroupements de date (create_date:day/week/month). ' +
        'Les bornes de la période, elles, restent en UTC comme les stocke Odoo.',
    ),
});

export const ListHelpdeskTeamsSchema = z.object({
  query: z.string().trim().min(1).max(200).optional().describe("Filtre sur le nom de l'équipe."),
  limit: z.number().int().min(1).max(100).default(50),
  includeTicketCount: z
    .boolean()
    .default(false)
    .describe('Joindre le nombre de tickets par équipe (un seul regroupement Odoo supplémentaire).'),
  ticketCountLastDays: z
    .number()
    .int()
    .positive()
    .max(3650)
    .optional()
    .describe('Restreint includeTicketCount à une fenêtre glissante. Sans valeur : depuis toujours.'),
});

export type HelpdeskStatsParams = z.infer<typeof HelpdeskStatsSchema>;
export type ListHelpdeskTeamsParams = z.infer<typeof ListHelpdeskTeamsSchema>;

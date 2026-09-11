import { z } from 'zod';
import { GROUPABLE_FIELDS, NIVEAU_VALUES, RESEAU_VALUES } from '../contacts/fieldMap.js';

/**
 * Aucun paramètre `domain` libre, aucun passe-plat `execute_kw` : uniquement des
 * filtres nommés et typés. C'est ce qui rend impossible d'écrire un domaine
 * syntaxiquement correct mais faux.
 */

/** Un FASE peut être fourni en nombre ou en chaîne : les deux mènent au même résultat. */
export const FaseSchema = z.union([z.number().int().nonnegative(), z.string().trim().min(1)]);

export const ContactProfileSchema = z
  .enum(['short', 'full'])
  .default('short')
  .describe('short = identité, FASE, réseau, niveau, ville. full = ajoute équipement et coordonnées.');

export const SearchSchoolsSchema = z.object({
  nom: z.string().trim().min(1).max(200).optional().describe("Nom de l'établissement, insensible à la casse et aux accents."),
  fase: FaseSchema.optional().describe('Numéro FASE. Nombre ou chaîne ; les FASE composites "a/b" sont reconnus.'),
  fasePo: FaseSchema.optional().describe('FASE du pouvoir organisateur — la façon de regrouper les écoles d\'un même P.O.'),
  nomPo: z.string().trim().min(1).max(200).optional(),
  reseau: z.enum(RESEAU_VALUES).optional(),
  niveau: z.enum(NIVEAU_VALUES).optional(),
  diocese: z.string().trim().min(1).max(100).optional(),
  entite: z.string().trim().min(1).max(100).optional(),
  ville: z.string().trim().min(1).max(100).optional(),
  codePostal: z.string().trim().min(1).max(20).optional(),
  nombreElevesMin: z.number().int().nonnegative().optional(),
  nombreElevesMax: z.number().int().nonnegative().optional(),
  logicielComptable: z.string().trim().min(1).max(100).optional().describe('Texte libre non normalisé — comparaison insensible à la casse.'),
  licenceProeco: z.string().trim().min(1).max(100).optional(),
  idCabanga: z.string().trim().min(1).max(100).optional(),
  edid: z.string().trim().min(1).max(100).optional(),
  serveurCloud: z.string().trim().min(1).max(100).optional(),
  serveurNet: z.string().trim().min(1).max(100).optional(),
  moduleFrais: z.boolean().optional(),
  moduleSms: z.boolean().optional(),
  proeco5v2: z.boolean().optional().describe('Attention : renseigné sur 7 fiches sur 2065.'),
  appartientPoMultiEcole: z.boolean().optional(),

  includeArchived: z.boolean().default(false),
  profile: ContactProfileSchema,
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  order: z
    .enum(['nom asc', 'nom desc', 'nombreEleves asc', 'nombreEleves desc', 'id asc', 'id desc'])
    .default('nom asc'),
});

/**
 * Objet nu : `registerTool` a besoin d'un `.shape`, que `.refine()` ne fournit
 * pas (il produit un ZodEffects). La règle « id ou fase » est donc vérifiée par
 * `GetContactSchema`, appliqué dans le handler.
 */
export const GetContactShape = z.object({
  id: z.number().int().positive().optional(),
  fase: FaseSchema.optional(),
  profile: ContactProfileSchema,
  includeChildren: z
    .boolean()
    .default(false)
    .describe('Joindre les contacts rattachés (personnes physiques) — identifiants et noms uniquement.'),
});

export const GetContactSchema = GetContactShape.refine(
  (v) => v.id !== undefined || v.fase !== undefined,
  { message: 'Fournir soit `id` (identifiant Odoo), soit `fase` (numéro FASE de l\'établissement).' },
);

export const ListContactFieldValuesSchema = z.object({
  champ: z
    .enum(GROUPABLE_FIELDS as [string, ...string[]])
    .describe('Axe dont on veut les valeurs distinctes et leurs effectifs.'),
  limit: z.number().int().min(1).max(200).default(50),
  includeArchived: z.boolean().default(false),
});

export const ContactStatsSchema = z.object({
  groupBy: z
    .array(z.enum(GROUPABLE_FIELDS as [string, ...string[]]))
    .min(1)
    .max(3)
    .describe('Axes de regroupement, 1 à 3.'),
  reseau: z.enum(RESEAU_VALUES).optional(),
  niveau: z.enum(NIVEAU_VALUES).optional(),
  fasePo: FaseSchema.optional(),
  ville: z.string().trim().min(1).max(100).optional(),
  nombreElevesMin: z.number().int().nonnegative().optional(),
  nombreElevesMax: z.number().int().nonnegative().optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100).describe('Nombre maximum de GROUPES.'),
});

export const DescribeContactFieldsSchema = z.object({
  champ: z.string().trim().min(1).optional().describe('Limiter la description à un seul champ.'),
});

export const ResolveSchoolFromTicketSchema = z.object({
  ticketId: z.number().int().positive(),
});

export type SearchSchoolsParams = z.infer<typeof SearchSchoolsSchema>;
export type GetContactParams = z.infer<typeof GetContactSchema>;
export type ListContactFieldValuesParams = z.infer<typeof ListContactFieldValuesSchema>;
export type ContactStatsParams = z.infer<typeof ContactStatsSchema>;
export type ResolveSchoolFromTicketParams = z.infer<typeof ResolveSchoolFromTicketSchema>;

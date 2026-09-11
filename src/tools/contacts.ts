import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OdooClient } from '../clients/odooClient.js';
import {
  ContactStatsSchema,
  DescribeContactFieldsSchema,
  GetContactSchema,
  GetContactShape,
  ListContactFieldValuesSchema,
  ResolveSchoolFromTicketSchema,
  SearchSchoolsSchema,
} from '../schemas/contacts.js';
import {
  computeContactStats,
  getContact,
  listContactFieldValues,
  resolveSchoolFromTicket,
  searchSchools,
} from '../services/contactService.js';
import {
  CONTACT_FIELDS,
  FILL_RATE_MEASURED_AT,
  FILL_RATE_SAMPLE,
  GROUPABLE_FIELDS,
} from '../contacts/fieldMap.js';
import { toMcpToolError } from '../security/errors.js';
import { logger } from '../utils/logger.js';

function asTextContent(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

function json(payload: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [asTextContent(JSON.stringify(payload))] };
}

/** Renvoi d'erreur homogène, en français, nommant l'outil fautif. */
function fail(outil: string, err: unknown) {
  const mcpError = toMcpToolError(err);
  logger.error(`${outil} a échoué`, { code: mcpError.code });
  return { isError: true as const, content: [asTextContent(`[${mcpError.code}] ${mcpError.message}`)] };
}

const RENVOI_DICTIONNAIRE =
  'En cas de doute sur un nom de champ ou une valeur admise, appelez describe_contact_fields : ' +
  'il donne la liste exacte des filtres, leurs types, leurs valeurs possibles et leur taux de remplissage.';

export function registerContactTools(server: McpServer, client: OdooClient): void {
  // --- Le dictionnaire : l'outil qui rend les autres utilisables ---
  server.registerTool(
    'describe_contact_fields',
    {
      title: 'Dictionnaire des champs Contacts (Odoo)',
      description:
        "Décrit les champs exposés du module Contact d'Odoo : nom métier à employer dans les " +
        'filtres, type, valeurs admises pour les sélections, taux de remplissage mesuré, et ' +
        "avertissements. À appeler AVANT toute recherche pour ne rien deviner.\n" +
        `Taux mesurés le ${FILL_RATE_MEASURED_AT} sur ${FILL_RATE_SAMPLE}.`,
      inputSchema: DescribeContactFieldsSchema.shape,
    },
    async (rawArgs) => {
      const parsed = DescribeContactFieldsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return { isError: true, content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)] };
      }
      const champs = parsed.data.champ
        ? CONTACT_FIELDS.filter((f) => f.name === parsed.data.champ)
        : CONTACT_FIELDS;
      if (champs.length === 0) {
        return {
          isError: true,
          content: [
            asTextContent(
              `Champ inconnu : "${parsed.data.champ}". Champs disponibles : ${CONTACT_FIELDS.map((f) => f.name).join(', ')}.`,
            ),
          ],
        };
      }
      return json({
        source: 'contact_fields',
        mesureLe: FILL_RATE_MEASURED_AT,
        echantillon: FILL_RATE_SAMPLE,
        axesRegroupables: GROUPABLE_FIELDS,
        champs,
        rappels: [
          "Les numéros FASE sont stockés en TEXTE ; un entier est accepté et donne le même résultat.",
          "Un numéro FASE n'identifie pas une école de façon unique : 14 numéros sont partagés.",
          'Le rattachement au pouvoir organisateur est textuel (fasePo), pas relationnel : parent_id est vide sur toutes les sociétés.',
        ],
      });
    },
  );

  // --- Recherche d'écoles ---
  server.registerTool(
    'search_schools',
    {
      title: 'Rechercher des écoles (Odoo)',
      description:
        "Recherche en lecture seule dans les fiches d'établissements (res.partner, is_company = true). " +
        'Filtres nommés et typés uniquement : nom, fase, fasePo, reseau, niveau, diocese, ville, ' +
        'codePostal, nombreElevesMin/Max, logicielComptable, licences, modules… Aucun domaine Odoo brut.\n' +
        '`count` est la taille de la page, `total` le nombre de correspondances. Le tri est ' +
        'déterministe (défaut "nom asc", départagé par id).\n' +
        'La recherche par nom est insensible à la casse, à la ponctuation et à l\'ordre des mots ' +
        '(« Sainte-Marie », « sainte marie » et « marie sainte » convergent), mais PAS aux accents : ' +
        '« ecole » ne trouve pas « École ». ' +
        RENVOI_DICTIONNAIRE,
      inputSchema: SearchSchoolsSchema.shape,
    },
    async (rawArgs) => {
      const parsed = SearchSchoolsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return { isError: true, content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)] };
      }
      try {
        return json({ source: 'schools', ...(await searchSchools(client, parsed.data)) });
      } catch (err) {
        return fail('search_schools', err);
      }
    },
  );

  // --- Fiche unique, par id ou par FASE ---
  server.registerTool(
    'get_contact',
    {
      title: 'Fiche école par identifiant ou par FASE (Odoo)',
      description:
        "Renvoie la ou les fiches correspondant à un identifiant Odoo ou à un numéro FASE. " +
        "C'est l'outil pour répondre à « quelle école porte le FASE 3003 ».\n" +
        'Le FASE est accepté en nombre comme en chaîne. Les numéros composites ("5448/3048") sont ' +
        'reconnus, y compris quand on n\'en fournit qu\'une moitié.\n' +
        "ATTENTION : un FASE n'identifie pas une école de façon unique — 14 numéros sont portés par " +
        'plusieurs fiches. La réponse est donc toujours une LISTE, et signale la multiplicité.\n' +
        "Si rien ne correspond, l'erreur indique ce qui a été essayé et ce qui aurait fonctionné " +
        '(par exemple : le numéro existe comme FASE de pouvoir organisateur).\n' +
        'Fournir `id` OU `fase`.',
      inputSchema: GetContactShape.shape,
    },
    async (rawArgs) => {
      const parsed = GetContactSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return { isError: true, content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)] };
      }
      try {
        return json({ source: 'contact', ...(await getContact(client, parsed.data)) });
      } catch (err) {
        return fail('get_contact', err);
      }
    },
  );

  // --- Lexique réel d'un axe ---
  server.registerTool(
    'list_contact_field_values',
    {
      title: "Valeurs réelles d'un champ Contacts (Odoo)",
      description:
        "Valeurs distinctes réellement présentes sur un axe, avec leur effectif. Complément de " +
        'describe_contact_fields : celui-ci donne la grammaire, celui-là le lexique réel — utile ' +
        'notamment pour les champs texte libre non normalisés comme logicielComptable.\n' +
        `Axes acceptés : ${GROUPABLE_FIELDS.join(', ')}.`,
      inputSchema: ListContactFieldValuesSchema.shape,
    },
    async (rawArgs) => {
      const parsed = ListContactFieldValuesSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return { isError: true, content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)] };
      }
      try {
        return json({ source: 'contact_field_values', ...(await listContactFieldValues(client, parsed.data)) });
      } catch (err) {
        return fail('list_contact_field_values', err);
      }
    },
  );

  // --- Agrégation ---
  server.registerTool(
    'contact_stats',
    {
      title: 'Compter et ventiler les écoles (Odoo)',
      description:
        'Compte et ventile les établissements sans les récupérer (search_count + read_group). ' +
        'Répond à « combien d\'écoles par réseau », « par niveau », « par logiciel comptable ».\n' +
        '`total` vient toujours de search_count, jamais de la somme des groupes ; `sumOfGroups` ' +
        'est fourni à côté pour que tout écart soit visible.\n' +
        'Les avertissements signalent les axes multivalués et les axes peu renseignés — un groupe ' +
        'au libellé null mesure la part non saisie, pas une absence réelle. ' +
        RENVOI_DICTIONNAIRE,
      inputSchema: ContactStatsSchema.shape,
    },
    async (rawArgs) => {
      const parsed = ContactStatsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return { isError: true, content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)] };
      }
      try {
        return json({ source: 'contact_stats', ...(await computeContactStats(client, parsed.data)) });
      } catch (err) {
        return fail('contact_stats', err);
      }
    },
  );

  // --- Jointure avec Assistance ---
  server.registerTool(
    'resolve_school_from_ticket',
    {
      title: 'Retrouver l’école d’un ticket (Odoo)',
      description:
        "À partir d'un identifiant de ticket d'Assistance, remonte au client puis à la fiche de " +
        "l'établissement (FASE, réseau, niveau, nombre d'élèves). C'est la jointure entre Assistance " +
        'et Contacts.\n' +
        'Mesuré sur 1 000 tickets : 99,5 % portent un client, mais seulement 12 % pointent ' +
        "directement une fiche avec un FASE — dans 78 % des cas le client est une personne dont le " +
        "rattachement parent est l'école, et l'outil remonte automatiquement. Environ 10 % des " +
        'tickets restent non résolus ; la réponse le dit explicitement via le champ `voie`.',
      inputSchema: ResolveSchoolFromTicketSchema.shape,
    },
    async (rawArgs) => {
      const parsed = ResolveSchoolFromTicketSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return { isError: true, content: [asTextContent(`Paramètres invalides: ${parsed.error.message}`)] };
      }
      try {
        return json({ source: 'school_from_ticket', ...(await resolveSchoolFromTicket(client, parsed.data.ticketId)) });
      } catch (err) {
        return fail('resolve_school_from_ticket', err);
      }
    },
  );
}

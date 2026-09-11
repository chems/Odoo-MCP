import type { OdooClient } from '../clients/odooClient.js';
import { combineDomainsAnd, type OdooDomain } from '../utils/domainBuilder.js';
import { ALLOWED_FIELDS, PARTNER_SHORT_FIELDS } from '../security/whitelist.js';
import {
  applyCategoryLabels,
  collectCategoryIds,
  mapPartnerToContact,
  type NormalizedContact,
} from '../mappers/contactMapper.js';
import {
  CONTACT_FIELDS,
  MULTIVALUED_CONTACT_FIELDS,
  fieldByName,
  type ContactFieldSpec,
} from '../contacts/fieldMap.js';
import {
  FASE_FIELD,
  FASE_PO_FIELD,
  buildFaseDomain,
  normalizeFase,
  type NormalizedFase,
} from '../utils/fase.js';
import { splitQueryIntoOdooTerms } from '../utils/tokenize.js';
import type {
  ContactStatsParams,
  GetContactParams,
  ListContactFieldValuesParams,
  SearchSchoolsParams,
} from '../schemas/contacts.js';

/** Toutes les recherches d'écoles portent sur les sociétés. */
const SOCIETE: unknown[] = ['is_company', '=', true];

export class ContactNotFoundError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'ContactNotFoundError';
  }
}

function fieldsFor(profile: 'short' | 'full'): string[] {
  return profile === 'short' ? [...PARTNER_SHORT_FIELDS] : [...ALLOWED_FIELDS['res.partner']];
}

/** Traduit un tri métier en tri Odoo, avec départage déterministe par id. */
function buildContactOrder(order: string): string {
  const [champ, sens] = order.split(' ');
  const odooField = champ === 'nom' ? 'name' : champ === 'nombreEleves' ? 'x_studio_nombre_dlves' : 'id';
  return odooField === 'id' ? `id ${sens}` : `${odooField} ${sens}, id asc`;
}

/**
 * Recherche par nom, tolérante à la casse, à la ponctuation et à l'ordre des mots.
 *
 * Chaque terme doit apparaître dans le nom (AND de `ilike`), ce qui fait
 * converger « Sainte-Marie », « sainte marie » et « MARIE SAINTE ».
 *
 * **Limite assumée** : `ilike` de PostgreSQL n'est pas insensible aux accents, et
 * un domaine Odoo ne peut pas appeler `unaccent`. « ecole » ne trouvera donc pas
 * « École ». Les termes sont volontairement transmis **sans** normalisation
 * d'accents : les dépouiller côté client aggraverait le problème, puisque la
 * valeur stockée, elle, garde les siens.
 */
function buildNameDomain(nom: string): OdooDomain {
  return splitQueryIntoOdooTerms(nom).map((terme) => ['name', 'ilike', terme]);
}

function buildSchoolDomain(params: SearchSchoolsParams): {
  domain: OdooDomain;
  faseNormalise?: NormalizedFase;
  fasePoNormalise?: NormalizedFase;
} {
  const parts: OdooDomain[] = [[SOCIETE]];
  let faseNormalise: NormalizedFase | undefined;
  let fasePoNormalise: NormalizedFase | undefined;

  if (params.nom !== undefined) parts.push(buildNameDomain(params.nom));

  if (params.fase !== undefined) {
    faseNormalise = normalizeFase(params.fase);
    parts.push(buildFaseDomain(faseNormalise, FASE_FIELD));
  }
  if (params.fasePo !== undefined) {
    fasePoNormalise = normalizeFase(params.fasePo);
    parts.push(buildFaseDomain(fasePoNormalise, FASE_PO_FIELD));
  }

  // Égalités simples sur les sélections et identifiants.
  const egalites: [keyof SearchSchoolsParams, string][] = [
    ['reseau', 'x_studio_rseau'],
    ['niveau', 'x_studio_niveau'],
    ['codePostal', 'zip'],
    ['idCabanga', 'x_studio_id_cabanga'],
    ['edid', 'x_studio_edid'],
    ['moduleFrais', 'x_studio_module_frais'],
    ['moduleSms', 'x_studio_module_sms'],
    ['proeco5v2', 'x_studio_proeco_5_v2'],
    ['appartientPoMultiEcole', 'x_studio_appartient_po_multi_cole'],
  ];
  for (const [param, odooField] of egalites) {
    const valeur = params[param];
    if (valeur !== undefined) parts.push([[odooField, '=', valeur]]);
  }

  // Correspondances textuelles insensibles à la casse (champs libres, non normalisés).
  const contient: [keyof SearchSchoolsParams, string][] = [
    ['nomPo', 'x_studio_nom_du_po'],
    ['diocese', 'x_studio_diocse'],
    ['entite', 'x_studio_entit'],
    ['ville', 'city'],
    ['logicielComptable', 'x_studio_logiciel_comptable'],
    ['licenceProeco', 'x_studio_license_proeco'],
    ['serveurCloud', 'x_studio_serveur_cloud'],
    ['serveurNet', 'x_studio_serveur_net'],
  ];
  for (const [param, odooField] of contient) {
    const valeur = params[param];
    if (valeur !== undefined) parts.push([[odooField, 'ilike', valeur]]);
  }

  if (params.nombreElevesMin !== undefined) {
    parts.push([['x_studio_nombre_dlves', '>=', params.nombreElevesMin]]);
  }
  if (params.nombreElevesMax !== undefined) {
    parts.push([['x_studio_nombre_dlves', '<=', params.nombreElevesMax]]);
  }

  return { domain: combineDomainsAnd(...parts), faseNormalise, fasePoNormalise };
}

/** Résout les libellés d'étiquettes d'une page en un seul appel. */
async function resolveCategoryLabels(
  client: OdooClient,
  contacts: NormalizedContact[],
): Promise<void> {
  const ids = collectCategoryIds(contacts);
  if (ids.length === 0) return;
  const rows = await client.searchRead({
    model: 'res.partner.category',
    method: 'search_read',
    domain: [['id', 'in', ids]],
    fields: ['id', 'name'],
    limit: ids.length,
  });
  const labels = new Map<number, string>();
  for (const row of rows) {
    if (typeof row.id === 'number' && typeof row.name === 'string') labels.set(row.id, row.name);
  }
  applyCategoryLabels(contacts, labels);
}

export interface SearchSchoolsResult {
  count: number;
  total: number;
  hasMore: boolean;
  order: string;
  results: NormalizedContact[];
  notes: string[];
}

export async function searchSchools(
  client: OdooClient,
  params: SearchSchoolsParams,
): Promise<SearchSchoolsResult> {
  const { domain, faseNormalise, fasePoNormalise } = buildSchoolDomain(params);
  const context = params.includeArchived ? { active_test: false } : undefined;
  const order = buildContactOrder(params.order);

  const [rows, total] = await Promise.all([
    client.searchRead({
      model: 'res.partner',
      method: 'search_read',
      domain,
      fields: fieldsFor(params.profile),
      limit: params.limit,
      offset: params.offset,
      order,
      context,
    }),
    client.searchCount({ model: 'res.partner', domain, context }),
  ]);

  const results = rows.map((row) => mapPartnerToContact(row));
  await resolveCategoryLabels(client, results);

  const notes: string[] = [];
  if (faseNormalise) notes.push(faseNormalise.explanation);
  if (fasePoNormalise) notes.push(`P.O. : ${fasePoNormalise.explanation}`);
  if (total > 1 && params.fase !== undefined) {
    notes.push(
      `${total} fiches portent ce FASE. Un numéro FASE n'est pas unique : implantations ` +
        "fondamental/secondaire d'un même établissement, ou doublons de fiches.",
    );
  }

  return {
    count: results.length,
    total,
    hasMore: params.offset + results.length < total,
    order,
    results,
    notes,
  };
}

/**
 * Message d'échec instructif : plutôt que « aucun résultat », on dit ce qui a
 * été tenté et ce qui aurait fonctionné.
 */
async function expliquerEchecFase(client: OdooClient, fase: NormalizedFase): Promise<string> {
  const pistes: string[] = [];

  // Le numéro existe-t-il comme FASE de P.O. plutôt que d'école ?
  const commePo = await client.searchCount({
    model: 'res.partner',
    domain: combineDomainsAnd([SOCIETE], buildFaseDomain(fase, FASE_PO_FIELD)),
  });
  if (commePo > 0) {
    pistes.push(
      `en revanche ${commePo} école(s) ont ce numéro comme FASE de pouvoir organisateur — ` +
        'utilisez le filtre fasePo.',
    );
  }

  // Un préfixe partiel correspond-il ? Fréquent avec les FASE composites.
  const partiel = await client.searchCount({
    model: 'res.partner',
    domain: combineDomainsAnd([SOCIETE], [[FASE_FIELD, 'ilike', fase.raw]]),
  });
  if (partiel > 0) {
    pistes.push(`${partiel} fiche(s) contiennent "${fase.raw}" dans leur FASE sans lui être égales.`);
  }

  return pistes.length === 0
    ? `Aucune école pour le FASE "${fase.raw}" (formes essayées : ${fase.variants.join(', ')}).`
    : `Aucune école dont le FASE vaut "${fase.raw}" ; ${pistes.join(' ')}`;
}

export interface GetContactResult {
  results: NormalizedContact[];
  count: number;
  notes: string[];
  children?: { id: number; nom: string | null; fonction: string | null }[];
}

export async function getContact(
  client: OdooClient,
  params: GetContactParams,
): Promise<GetContactResult> {
  const notes: string[] = [];
  let domain: OdooDomain;

  if (params.id !== undefined) {
    domain = [['id', '=', params.id]];
  } else {
    const fase = normalizeFase(params.fase!);
    notes.push(fase.explanation);
    domain = combineDomainsAnd([SOCIETE], buildFaseDomain(fase, FASE_FIELD));
  }

  const rows = await client.searchRead({
    model: 'res.partner',
    method: 'search_read',
    domain,
    fields: fieldsFor(params.profile),
    limit: 50,
    order: 'id asc',
  });

  if (rows.length === 0) {
    if (params.fase !== undefined) {
      throw new ContactNotFoundError(await expliquerEchecFase(client, normalizeFase(params.fase)));
    }
    throw new ContactNotFoundError(`Aucun contact d'identifiant ${params.id}.`);
  }

  const results = rows.map((row) => mapPartnerToContact(row));
  await resolveCategoryLabels(client, results);

  // Le FASE n'est pas une clé unique : le dire plutôt que d'en choisir une.
  if (results.length > 1) {
    notes.push(
      `${results.length} fiches portent ce FASE : ${results.map((r) => `#${r.id} ${r.nom}`).join(' | ')}. ` +
        'Le numéro FASE ne suffit pas à désigner un établissement.',
    );
  }

  const result: GetContactResult = { results, count: results.length, notes };

  if (params.includeChildren && results.length > 0) {
    const parentIds = results.map((r) => r.id);
    const enfants = await client.searchRead({
      model: 'res.partner',
      method: 'search_read',
      domain: [['parent_id', 'in', parentIds]],
      fields: ['id', 'name', 'function'],
      limit: 100,
      order: 'name asc',
    });
    result.children = enfants.map((e) => ({
      id: typeof e.id === 'number' ? e.id : 0,
      nom: typeof e.name === 'string' ? e.name : null,
      fonction: typeof e.function === 'string' ? e.function : null,
    }));
  }

  return result;
}

// --- Agrégation -------------------------------------------------------------

function assertGroupable(nom: string): ContactFieldSpec {
  const spec = fieldByName(nom);
  if (!spec || !spec.groupable) {
    const dispo = CONTACT_FIELDS.filter((f) => f.groupable).map((f) => f.name);
    throw new ContactNotFoundError(
      `Axe de regroupement inconnu ou non regroupable : "${nom}". Axes acceptés : ${dispo.join(', ')}.`,
    );
  }
  return spec;
}

export interface ContactFieldValue {
  valeur: string | null;
  count: number;
}

export async function listContactFieldValues(
  client: OdooClient,
  params: ListContactFieldValuesParams,
): Promise<{ champ: string; odooField: string; total: number; valeurs: ContactFieldValue[]; notes: string[] }> {
  const spec = assertGroupable(params.champ);
  const context = params.includeArchived ? { active_test: false } : undefined;
  const domain = [SOCIETE];

  const [rows, total] = await Promise.all([
    client.readGroup({
      model: 'res.partner',
      domain,
      fields: ['id'],
      groupby: [spec.odooField],
      limit: params.limit,
      context,
    }),
    client.searchCount({ model: 'res.partner', domain, context }),
  ]);

  const valeurs = rows
    .map((row) => {
      const brut = row[spec.odooField];
      const valeur = Array.isArray(brut)
        ? (brut[1] as string)
        : brut === false || brut == null
          ? null
          : String(brut);
      return { valeur, count: typeof row.__count === 'number' ? row.__count : 0 };
    })
    .sort((a, b) => b.count - a.count);

  const notes: string[] = [];
  if (spec.caveat) notes.push(spec.caveat);

  return { champ: params.champ, odooField: spec.odooField, total, valeurs, notes };
}

export interface ContactStatsGroup {
  key: { champ: string; id: number | null; label: string | null }[];
  count: number;
}

export async function computeContactStats(
  client: OdooClient,
  params: ContactStatsParams,
): Promise<{
  total: number;
  sumOfGroups: number;
  groupBy: string[];
  groupCount: number;
  groups: ContactStatsGroup[];
  warnings: string[];
}> {
  const specs = params.groupBy.map(assertGroupable);
  const context = params.includeArchived ? { active_test: false } : undefined;

  const parts: OdooDomain[] = [[SOCIETE]];
  if (params.reseau !== undefined) parts.push([['x_studio_rseau', '=', params.reseau]]);
  if (params.niveau !== undefined) parts.push([['x_studio_niveau', '=', params.niveau]]);
  if (params.ville !== undefined) parts.push([['city', 'ilike', params.ville]]);
  if (params.fasePo !== undefined) parts.push(buildFaseDomain(normalizeFase(params.fasePo), FASE_PO_FIELD));
  if (params.nombreElevesMin !== undefined) parts.push([['x_studio_nombre_dlves', '>=', params.nombreElevesMin]]);
  if (params.nombreElevesMax !== undefined) parts.push([['x_studio_nombre_dlves', '<=', params.nombreElevesMax]]);
  const domain = combineDomainsAnd(...parts);

  const [total, rows] = await Promise.all([
    client.searchCount({ model: 'res.partner', domain, context }),
    client.readGroup({
      model: 'res.partner',
      domain,
      fields: ['id'],
      groupby: specs.map((s) => s.odooField),
      limit: params.limit,
      context,
    }),
  ]);

  const groups: ContactStatsGroup[] = rows.map((row) => ({
    key: specs.map((spec) => {
      const brut = row[spec.odooField];
      if (Array.isArray(brut) && brut.length >= 2) {
        return {
          champ: spec.name,
          id: typeof brut[0] === 'number' ? brut[0] : null,
          label: typeof brut[1] === 'string' ? brut[1] : null,
        };
      }
      if (brut === false || brut == null) return { champ: spec.name, id: null, label: null };
      return { champ: spec.name, id: null, label: String(brut) };
    }),
    count: typeof row.__count === 'number' ? row.__count : 0,
  }));

  const sumOfGroups = groups.reduce((s, g) => s + g.count, 0);
  const warnings: string[] = [];

  const multivalues = params.groupBy.filter((n) => MULTIVALUED_CONTACT_FIELDS.includes(n));
  if (multivalues.length > 0) {
    warnings.push(
      `Axe multivalué (${multivalues.join(', ')}) : une fiche portant plusieurs valeurs est comptée ` +
        'dans chaque groupe, donc la somme des groupes peut dépasser le total.',
    );
  }
  if (rows.length === params.limit) {
    warnings.push(`Résultat tronqué à ${params.limit} groupes : la somme des groupes est incomplète.`);
  }
  for (const spec of specs) {
    if (spec.fillRate < 50) {
      warnings.push(
        `L'axe "${spec.name}" n'est renseigné que sur ${spec.fillRate} % des fiches : le groupe au ` +
          'libellé null mesure la part non saisie, pas une absence réelle.',
      );
    }
    if (spec.caveat) warnings.push(`${spec.name} — ${spec.caveat}`);
  }

  return { total, sumOfGroups, groupBy: [...params.groupBy], groupCount: groups.length, groups, warnings };
}

// --- Jointure avec Assistance ----------------------------------------------

export interface ResolvedSchool {
  ticketId: number;
  partenaire: { id: number; nom: string | null; estSociete: boolean | null } | null;
  ecole: NormalizedContact | null;
  /** Comment l'école a été atteinte. */
  voie: 'direct' | 'parent' | 'introuvable';
  notes: string[];
}

/**
 * Remonte d'un ticket à la fiche école.
 *
 * Mesuré sur 1 000 tickets : 99,5 % portent un `partner_id`, mais seulement 12 %
 * pointent directement une fiche avec un FASE — dans 78 % des cas, le partenaire
 * est une personne physique dont le `parent_id` est l'école.
 */
export async function resolveSchoolFromTicket(
  client: OdooClient,
  ticketId: number,
): Promise<ResolvedSchool> {
  const notes: string[] = [];
  const tickets = await client.searchRead({
    model: 'helpdesk.ticket',
    method: 'search_read',
    domain: [['id', '=', ticketId]],
    fields: ['id', 'name', 'partner_id'],
    limit: 1,
  });

  if (tickets.length === 0) {
    throw new ContactNotFoundError(`Aucun ticket d'identifiant ${ticketId}.`);
  }
  const brut = tickets[0]!.partner_id;
  if (!Array.isArray(brut)) {
    return { ticketId, partenaire: null, ecole: null, voie: 'introuvable', notes: ["Le ticket n'a pas de client renseigné."] };
  }

  const partnerId = brut[0] as number;
  const partenaires = await client.searchRead({
    model: 'res.partner',
    method: 'search_read',
    domain: [['id', '=', partnerId]],
    fields: [...ALLOWED_FIELDS['res.partner']],
    limit: 1,
  });
  if (partenaires.length === 0) {
    return { ticketId, partenaire: null, ecole: null, voie: 'introuvable', notes: ['Client du ticket illisible.'] };
  }

  const partenaire = mapPartnerToContact(partenaires[0]!);
  const resume = {
    id: partenaire.id,
    nom: partenaire.nom ?? null,
    estSociete: partenaire.estSociete ?? null,
  };

  if (partenaire.fase != null) {
    return { ticketId, partenaire: resume, ecole: partenaire, voie: 'direct', notes };
  }

  // Le client est le plus souvent une personne : l'école est son parent.
  if (partenaire.parent?.id != null) {
    const parents = await client.searchRead({
      model: 'res.partner',
      method: 'search_read',
      domain: [['id', '=', partenaire.parent.id]],
      fields: [...ALLOWED_FIELDS['res.partner']],
      limit: 1,
    });
    if (parents.length > 0) {
      const ecole = mapPartnerToContact(parents[0]!);
      notes.push(
        `Le client du ticket est ${partenaire.estSociete ? 'une société' : 'une personne'} sans FASE ; ` +
          "l'école a été atteinte via son rattachement parent.",
      );
      if (ecole.fase == null) notes.push("La fiche parente n'a pas non plus de numéro FASE.");
      return { ticketId, partenaire: resume, ecole, voie: 'parent', notes };
    }
  }

  notes.push(
    "Le client du ticket n'a ni FASE ni rattachement exploitable. Environ 10 % des tickets sont " +
      'dans ce cas.',
  );
  return { ticketId, partenaire: resume, ecole: null, voie: 'introuvable', notes };
}

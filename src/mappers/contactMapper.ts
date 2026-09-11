/**
 * Normalisation d'un enregistrement `res.partner` vers une fiche métier.
 *
 * Les noms exposés sont ceux de `CONTACT_FIELDS` : l'appelant ne voit jamais
 * `x_studio_rseau_1` ni aucun nom ORM.
 *
 * **Une clé n'est émise que si le champ Odoo correspondant a été demandé.** Le
 * profil court reste donc réellement court, au lieu de traîner une trentaine de
 * clés nulles par fiche — c'est le principe « économie de contexte » du plan.
 * L'appelant distingue ainsi « non demandé » (clé absente) de « non renseigné »
 * (clé à `null`, et champ listé dans `champsVides`).
 */
import { asString, extractMany2OneLabel } from './common.js';
import { splitFaseValue } from '../utils/fase.js';

export interface LabeledRef {
  id: number | null;
  label: string | null;
}

export interface NormalizedContact {
  id: number;
  nom?: string | null;
  nomComplet?: string | null;
  reference?: string | null;
  estSociete?: boolean;
  actif?: boolean;

  /** Numéro FASE tel que stocké. */
  fase?: string | null;
  /** Composantes d'un FASE composite (« 5448/3048 » → ["5448","3048"]). */
  faseParts?: string[];
  fasePo?: string | null;
  nomPo?: string | null;
  appartientPoMultiEcole?: boolean | null;
  edid?: string | null;
  idCabanga?: string | null;

  reseau?: string | null;
  niveau?: string | null;
  diocese?: string | null;
  entite?: string | null;
  nombreEleves?: number | null;
  secteur?: LabeledRef | null;
  etiquettes?: string[] | null;
  etiquetteIds?: number[] | null;

  /** Chaque clé n'est présente que si le champ correspondant a été demandé. */
  equipement?: Partial<{
    licenceProeco: string | null;
    licenceComptEco: string | null;
    licenceEdt: string | null;
    proeco5v2: boolean | null;
    dateActivationV2: string | null;
    moduleFrais: boolean | null;
    moduleSms: boolean | null;
    logicielComptable: string | null;
    serveurCloud: string | null;
    serveurNet: string | null;
  }>;

  /** Idem : partiel selon la projection demandée. */
  contact?: Partial<{
    email: string | null;
    emailEconomat: string | null;
    telephone: string | null;
    mobile: string | null;
    siteWeb: string | null;
    rue: string | null;
    codePostal: string | null;
    ville: string | null;
    pays: LabeledRef | null;
  }>;

  parent?: LabeledRef | null;
  /** Champs demandés à Odoo mais vides sur cette fiche. */
  champsVides: string[];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Odoo renvoie `false` aussi bien pour « faux » que pour « non renseigné ». */
function asOptionalBoolean(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function extractIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'number') return [item];
    if (Array.isArray(item) && typeof item[0] === 'number') return [item[0]];
    return [];
  });
}

function ref(value: unknown): LabeledRef | null {
  const { id, label } = extractMany2OneLabel(value);
  return id === null && label === null ? null : { id, label };
}

/** Champs métier dont l'absence de valeur mérite d'être signalée à l'appelant. */
const A_SIGNALER: [metier: string, odooField: string][] = [
  ['fase', 'x_studio_fase'],
  ['fasePo', 'x_studio_fase_po'],
  ['reseau', 'x_studio_rseau'],
  ['niveau', 'x_studio_niveau'],
  ['nombreEleves', 'x_studio_nombre_dlves'],
];

export function mapPartnerToContact(
  raw: Record<string, unknown>,
  categoryLabels?: ReadonlyMap<number, string>,
): NormalizedContact {
  const c: NormalizedContact = { id: asNumber(raw.id) ?? 0, champsVides: [] };

  /** N'affecte la clé que si le champ Odoo a été demandé. */
  const set = <K extends keyof NormalizedContact>(
    key: K,
    odooField: string,
    build: () => NormalizedContact[K],
  ): void => {
    if (raw[odooField] !== undefined) c[key] = build();
  };

  set('nom', 'name', () => asString(raw.name));
  set('nomComplet', 'complete_name', () => asString(raw.complete_name));
  set('reference', 'ref', () => asString(raw.ref));
  set('estSociete', 'is_company', () => raw.is_company === true);
  set('actif', 'active', () => raw.active !== false);

  set('fase', 'x_studio_fase', () => asString(raw.x_studio_fase));
  // `faseParts` n'est émis que pour les 76 valeurs composites : pour un numéro
  // simple, il ne ferait que répéter `fase`.
  const parts = splitFaseValue(raw.x_studio_fase);
  if (parts.length > 1) c.faseParts = parts;
  set('fasePo', 'x_studio_fase_po', () => asString(raw.x_studio_fase_po));
  set('nomPo', 'x_studio_nom_du_po', () => asString(raw.x_studio_nom_du_po));
  set('appartientPoMultiEcole', 'x_studio_appartient_po_multi_cole', () =>
    asOptionalBoolean(raw.x_studio_appartient_po_multi_cole),
  );
  set('edid', 'x_studio_edid', () => asString(raw.x_studio_edid));
  set('idCabanga', 'x_studio_id_cabanga', () => asString(raw.x_studio_id_cabanga));

  set('reseau', 'x_studio_rseau', () => asString(raw.x_studio_rseau));
  set('niveau', 'x_studio_niveau', () => asString(raw.x_studio_niveau));
  set('diocese', 'x_studio_diocse', () => asString(raw.x_studio_diocse));
  set('entite', 'x_studio_entit', () => asString(raw.x_studio_entit));
  set('nombreEleves', 'x_studio_nombre_dlves', () => asNumber(raw.x_studio_nombre_dlves));
  set('secteur', 'industry_id', () => ref(raw.industry_id));
  set('parent', 'parent_id', () => ref(raw.parent_id));

  if (raw.category_id !== undefined) {
    const ids = extractIds(raw.category_id);
    c.etiquetteIds = ids;
    c.etiquettes = ids.map((id) => categoryLabels?.get(id) ?? `#${id}`);
  }

  /** Sous-objet ne portant que les clés dont le champ Odoo a été demandé. */
  const sousObjet = (entrees: [string, string, () => unknown][]): Record<string, unknown> | undefined => {
    const bloc: Record<string, unknown> = {};
    for (const [cle, odooField, build] of entrees) {
      if (raw[odooField] !== undefined) bloc[cle] = build();
    }
    return Object.keys(bloc).length === 0 ? undefined : bloc;
  };

  c.equipement = sousObjet([
    ['licenceProeco', 'x_studio_license_proeco', () => asString(raw.x_studio_license_proeco)],
    ['licenceComptEco', 'x_studio_licence_compteco', () => asString(raw.x_studio_licence_compteco)],
    ['licenceEdt', 'x_studio_licence_edt', () => asString(raw.x_studio_licence_edt)],
    ['proeco5v2', 'x_studio_proeco_5_v2', () => asOptionalBoolean(raw.x_studio_proeco_5_v2)],
    ['dateActivationV2', 'x_studio_date_dactivation_v2', () => asString(raw.x_studio_date_dactivation_v2)],
    ['moduleFrais', 'x_studio_module_frais', () => asOptionalBoolean(raw.x_studio_module_frais)],
    ['moduleSms', 'x_studio_module_sms', () => asOptionalBoolean(raw.x_studio_module_sms)],
    ['logicielComptable', 'x_studio_logiciel_comptable', () => asString(raw.x_studio_logiciel_comptable)],
    ['serveurCloud', 'x_studio_serveur_cloud', () => asString(raw.x_studio_serveur_cloud)],
    ['serveurNet', 'x_studio_serveur_net', () => asString(raw.x_studio_serveur_net)],
  ]) as NormalizedContact['equipement'];

  c.contact = sousObjet([
    ['email', 'email', () => asString(raw.email)],
    ['emailEconomat', 'x_studio_email_economat', () => asString(raw.x_studio_email_economat)],
    ['telephone', 'phone', () => asString(raw.phone)],
    ['mobile', 'mobile', () => asString(raw.mobile)],
    ['siteWeb', 'website', () => asString(raw.website)],
    ['rue', 'street', () => [asString(raw.street), asString(raw.street2)].filter(Boolean).join(', ') || null],
    ['codePostal', 'zip', () => asString(raw.zip)],
    ['ville', 'city', () => asString(raw.city)],
    ['pays', 'country_id', () => ref(raw.country_id)],
  ]) as NormalizedContact['contact'];

  // « Demandé mais vide » se distingue de « non demandé » : le modèle doit
  // pouvoir dire « l'école n'a pas de FASE » plutôt que « je n'ai pas regardé ».
  for (const [metier, odooField] of A_SIGNALER) {
    if (raw[odooField] !== undefined && (raw[odooField] === false || raw[odooField] == null)) {
      c.champsVides.push(metier);
    }
  }

  return c;
}

export function collectCategoryIds(contacts: NormalizedContact[]): number[] {
  const ids = new Set<number>();
  for (const c of contacts) {
    for (const id of c.etiquetteIds ?? []) ids.add(id);
  }
  return [...ids];
}

export function applyCategoryLabels(
  contacts: NormalizedContact[],
  labels: ReadonlyMap<number, string>,
): void {
  for (const c of contacts) {
    const ids = c.etiquetteIds;
    if (ids == null) continue;
    c.etiquettes = ids.map((id) => labels.get(id) ?? `#${id}`);
  }
}

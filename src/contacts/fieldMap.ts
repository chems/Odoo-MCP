/**
 * Correspondance « nom métier → champ Odoo », et tout ce qui rend le service
 * utilisable sans documentation externe.
 *
 * Le consommateur est un modèle de langage : il ne doit jamais avoir à deviner
 * un nom de champ ni une valeur admise. Cette table est la source unique de
 * `describe_contact_fields`, des filtres nommés et des axes d'agrégation.
 *
 * **Aucune variante `x_studio_*_1` n'y figure** : les seize ont été mesurées
 * intégralement vides sur 2 065 sociétés (voir CONTACTS-lot1-correspondance.md §1).
 * La règle est uniforme — toujours le champ sans suffixe.
 *
 * Les taux de remplissage sont mesurés, datés, et exposés à l'appelant : un
 * filtre sur un champ rempli à 0 % doit se comprendre avant d'être lancé.
 */

/** Date des mesures de remplissage ci-dessous. */
export const FILL_RATE_MEASURED_AT = '2026-09-09';
export const FILL_RATE_SAMPLE = 'les 2 065 sociétés de scolares-test-20260902';

export type ContactFieldType = 'texte' | 'nombre' | 'booleen' | 'date' | 'selection' | 'relation' | 'relations';

export interface ContactFieldSpec {
  /** Nom métier, celui qu'emploie l'appelant. */
  name: string;
  /** Champ Odoo sous-jacent. Jamais exposé comme paramètre. */
  odooField: string;
  type: ContactFieldType;
  description: string;
  /** Part des sociétés où le champ est renseigné, en pourcentage. */
  fillRate: number;
  /** Valeurs admises, pour les sélections. */
  values?: readonly string[];
  /** Exemple de valeur réelle. */
  example?: string;
  /** Utilisable comme filtre de `search_schools`. */
  filterable: boolean;
  /** Utilisable comme axe de `contact_stats` / `list_contact_field_values`. */
  groupable: boolean;
  /** Avertissement à faire remonter à l'appelant. */
  caveat?: string;
}

/** Valeurs relevées par `fields_get` le 09/09/2026, effectifs mesurés. */
export const RESEAU_VALUES = [
  'Libre SeGEC',
  'Libre Non-SeGec',
  'Communal',
  'Provincial',
  'WBE',
  'Autre',
] as const;

export const NIVEAU_VALUES = [
  'Fondamental Ordinaire',
  'Fondamental Spécialisé',
  'Fondamental',
  'Fondamental & Secondaire',
  'Secondaire',
  'Secondaire Ordinaire',
  'Secondaire Spécialisé',
  'Supérieur',
] as const;

export const CONTACT_FIELDS: readonly ContactFieldSpec[] = [
  {
    name: 'nom',
    odooField: 'name',
    type: 'texte',
    description: "Nom de l'établissement. Recherche insensible à la casse et aux accents.",
    fillRate: 100,
    example: 'Institut Sainte-Marie d\'Arlon',
    filterable: true,
    groupable: false,
  },
  {
    name: 'fase',
    odooField: 'x_studio_fase',
    type: 'texte',
    description:
      "Numéro FASE de l'établissement. Stocké en TEXTE, pas en nombre. Accepte un entier " +
      'ou une chaîne indifféremment.',
    fillRate: 81,
    example: '3003',
    filterable: true,
    groupable: false,
    caveat:
      "Le FASE n'identifie pas une école de façon unique : 14 numéros sont portés par plusieurs " +
      'fiches (implantations fondamental/secondaire, ou doublons). 76 valeurs sont composites ' +
      '("5448/3048") et sont reconnues comme telles. Aucune valeur ne porte de zéro de tête.',
  },
  {
    name: 'fasePo',
    odooField: 'x_studio_fase_po',
    type: 'texte',
    description: "Numéro FASE du pouvoir organisateur dont dépend l'établissement.",
    fillRate: 80,
    example: '1057',
    filterable: true,
    groupable: false,
    caveat:
      "Le rattachement au P.O. est TEXTUEL, pas relationnel : `parent_id` est vide sur la " +
      'totalité des sociétés. Pour trouver les écoles d\'un même P.O., filtrer sur fasePo.',
  },
  {
    name: 'nomPo',
    odooField: 'x_studio_nom_du_po',
    type: 'texte',
    description: 'Nom du pouvoir organisateur.',
    fillRate: 9,
    filterable: true,
    groupable: true,
    caveat: 'Rempli sur 9 % des fiches seulement — préférer fasePo.',
  },
  {
    name: 'reseau',
    odooField: 'x_studio_rseau',
    type: 'selection',
    description: "Réseau d'enseignement.",
    fillRate: 82,
    values: RESEAU_VALUES,
    example: 'Libre SeGEC',
    filterable: true,
    groupable: true,
  },
  {
    name: 'niveau',
    odooField: 'x_studio_niveau',
    type: 'selection',
    description: "Niveau d'enseignement.",
    fillRate: 79,
    values: NIVEAU_VALUES,
    example: 'Fondamental Ordinaire',
    filterable: true,
    groupable: true,
    caveat:
      "La nomenclature est ambiguë à la source : « Fondamental » (11 fiches) coexiste avec " +
      '« Fondamental Ordinaire » (876), et « Secondaire » (158) avec « Secondaire Ordinaire » (404). ' +
      'Les valeurs sont exposées telles quelles, sans fusion.',
  },
  {
    name: 'diocese',
    odooField: 'x_studio_diocse',
    type: 'texte',
    description: 'Diocèse de rattachement.',
    fillRate: 40,
    filterable: true,
    groupable: true,
  },
  {
    name: 'entite',
    odooField: 'x_studio_entit',
    type: 'texte',
    description: 'Entité administrative.',
    fillRate: 39,
    filterable: true,
    groupable: true,
  },
  {
    name: 'nombreEleves',
    odooField: 'x_studio_nombre_dlves',
    type: 'nombre',
    description: "Nombre d'élèves. Filtrable par bornes (nombreElevesMin / nombreElevesMax).",
    fillRate: 72,
    example: '312',
    filterable: true,
    groupable: false,
  },
  {
    name: 'edid',
    odooField: 'x_studio_edid',
    type: 'texte',
    description: 'Identifiant EDid.',
    fillRate: 44,
    filterable: true,
    groupable: false,
  },
  {
    name: 'idCabanga',
    odooField: 'x_studio_id_cabanga',
    type: 'texte',
    description: 'Identifiant Cabanga.',
    fillRate: 10,
    filterable: true,
    groupable: false,
  },
  {
    name: 'reference',
    odooField: 'ref',
    type: 'texte',
    description: 'Référence interne Odoo.',
    fillRate: 84,
    filterable: true,
    groupable: false,
  },
  {
    name: 'appartientPoMultiEcole',
    odooField: 'x_studio_appartient_po_multi_cole',
    type: 'booleen',
    description: "L'établissement appartient à un P.O. regroupant plusieurs écoles.",
    fillRate: 52,
    filterable: true,
    groupable: true,
  },
  {
    name: 'licenceProeco',
    odooField: 'x_studio_license_proeco',
    type: 'texte',
    description: 'Numéro de licence ProEco.',
    fillRate: 75,
    filterable: true,
    groupable: false,
  },
  {
    name: 'licenceComptEco',
    odooField: 'x_studio_licence_compteco',
    type: 'texte',
    description: 'Numéro de licence ComptEco.',
    fillRate: 34,
    filterable: true,
    groupable: false,
  },
  {
    name: 'licenceEdt',
    odooField: 'x_studio_licence_edt',
    type: 'texte',
    description: 'Numéro de licence EDT.',
    fillRate: 20,
    filterable: true,
    groupable: false,
  },
  {
    name: 'logicielComptable',
    odooField: 'x_studio_logiciel_comptable',
    type: 'texte',
    description: 'Logiciel comptable utilisé.',
    fillRate: 35,
    example: 'ComptEco',
    filterable: true,
    groupable: true,
    caveat:
      'Champ TEXTE LIBRE, non normalisé : « ComptEco » (656), « compteco » (6) et « Compteco » (3) ' +
      'cohabitent. Le filtre est insensible à la casse ; le regroupement, lui, les compte séparément.',
  },
  {
    name: 'serveurCloud',
    odooField: 'x_studio_serveur_cloud',
    type: 'texte',
    description: 'Serveur Cloud affecté.',
    fillRate: 77,
    filterable: true,
    groupable: true,
  },
  {
    name: 'serveurNet',
    odooField: 'x_studio_serveur_net',
    type: 'texte',
    description: 'Serveur Net affecté.',
    fillRate: 77,
    filterable: true,
    groupable: true,
  },
  {
    name: 'moduleFrais',
    odooField: 'x_studio_module_frais',
    type: 'booleen',
    description: 'Module Frais activé.',
    fillRate: 30,
    filterable: true,
    groupable: true,
  },
  {
    name: 'moduleSms',
    odooField: 'x_studio_module_sms',
    type: 'booleen',
    description: 'Module SMS activé.',
    fillRate: 18,
    filterable: true,
    groupable: true,
  },
  {
    name: 'proeco5v2',
    odooField: 'x_studio_proeco_5_v2',
    type: 'booleen',
    description: 'Passage à ProEco 5 v2.',
    fillRate: 0,
    filterable: true,
    groupable: true,
    caveat:
      'Renseigné sur 7 fiches seulement sur 2 065. Un filtre dessus renverra presque toujours ' +
      'zéro résultat — ce qui traduit un champ peu saisi, pas une absence de déploiement.',
  },
  {
    name: 'dateActivationV2',
    odooField: 'x_studio_date_dactivation_v2',
    type: 'date',
    description: "Date d'activation de ProEco 5 v2.",
    fillRate: 0,
    filterable: false,
    groupable: false,
    caveat: 'Renseigné sur 1 fiche sur 2 065. Exposé pour information, pas comme filtre.',
  },
  {
    name: 'ville',
    odooField: 'city',
    type: 'texte',
    description: 'Commune.',
    fillRate: 99,
    filterable: true,
    groupable: true,
  },
  {
    name: 'codePostal',
    odooField: 'zip',
    type: 'texte',
    description: 'Code postal.',
    fillRate: 98,
    filterable: true,
    groupable: true,
  },
  {
    name: 'pays',
    odooField: 'country_id',
    type: 'relation',
    description: 'Pays.',
    fillRate: 98,
    filterable: false,
    groupable: true,
  },
  {
    name: 'secteur',
    odooField: 'industry_id',
    type: 'relation',
    description: "Secteur d'activité Odoo.",
    fillRate: 86,
    filterable: false,
    groupable: true,
  },
  {
    name: 'etiquettes',
    odooField: 'category_id',
    type: 'relations',
    description: 'Étiquettes Odoo, résolues en libellés.',
    fillRate: 87,
    filterable: false,
    groupable: true,
    caveat: 'Axe multivalué : une fiche portant plusieurs étiquettes compte dans plusieurs groupes.',
  },
  {
    name: 'email',
    odooField: 'email',
    type: 'texte',
    description: "Courriel de l'établissement (adresse d'organisation, pas nominative).",
    fillRate: 81,
    filterable: true,
    groupable: false,
  },
  {
    name: 'emailEconomat',
    odooField: 'x_studio_email_economat',
    type: 'texte',
    description: "Courriel de l'économat.",
    fillRate: 72,
    filterable: false,
    groupable: false,
  },
  {
    name: 'telephone',
    odooField: 'phone',
    type: 'texte',
    description: 'Téléphone.',
    fillRate: 80,
    filterable: false,
    groupable: false,
  },
  {
    name: 'fonction',
    odooField: 'function',
    type: 'texte',
    description: 'Fonction occupée.',
    fillRate: 0,
    filterable: false,
    groupable: false,
    caveat: 'Renseigné sur 5 fiches sur 2 065 : sans usage pratique côté sociétés.',
  },
  {
    name: 'parent',
    odooField: 'parent_id',
    type: 'relation',
    description: 'Société parente.',
    fillRate: 0,
    filterable: false,
    groupable: false,
    caveat:
      'VIDE sur la totalité des 2 065 sociétés. La hiérarchie réelle est : personne → école via ' +
      'parent_id, et école → P.O. via fasePo (textuel). Ne pas espérer y trouver le P.O.',
  },
];

const BY_NAME = new Map(CONTACT_FIELDS.map((f) => [f.name, f]));
const BY_ODOO = new Map(CONTACT_FIELDS.map((f) => [f.odooField, f]));

export function fieldByName(name: string): ContactFieldSpec | undefined {
  return BY_NAME.get(name);
}

export function fieldByOdooName(odooField: string): ContactFieldSpec | undefined {
  return BY_ODOO.get(odooField);
}

/** Axes autorisés pour `contact_stats` et `list_contact_field_values`. */
export const GROUPABLE_FIELDS = CONTACT_FIELDS.filter((f) => f.groupable).map((f) => f.name);

/** Axes multivalués : la somme des groupes peut dépasser le total. */
export const MULTIVALUED_CONTACT_FIELDS: readonly string[] = ['etiquettes'];

import { OdooOperationNotAllowedError } from './errors.js';

export const ALLOWED_MODELS = [
  'knowledge.article',
  'helpdesk.ticket',
  'mail.message',
  'helpdesk.team',
  'helpdesk.tag',
  'res.partner',
  'res.partner.category',
] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

/** Les trois seules méthodes Odoo employées. Toutes en lecture. */
export const ALLOWED_METHODS = ['search_read', 'search_count', 'read_group'] as const;
export type AllowedMethod = (typeof ALLOWED_METHODS)[number];

/**
 * Matrice fermée des seules opérations Odoo autorisées par ce serveur MCP.
 * Toute paire (model, method) absente de cette liste doit être rejetée avant
 * tout appel réseau vers Odoo. C'est le cœur de la contrainte "lecture seule".
 *
 * Elle est **explicite par modèle**, et non un produit cartésien
 * modèles × méthodes : chaque modèle n'obtient que ce dont il a réellement
 * besoin, et ajouter une méthode n'en ouvre pas l'accès partout à son insu.
 */
const ALLOWED_OPERATIONS_BY_MODEL: Record<AllowedModel, readonly AllowedMethod[]> = {
  'knowledge.article': ['search_read'],
  'helpdesk.ticket': ['search_read', 'search_count', 'read_group'],
  'mail.message': ['search_read'],
  'helpdesk.team': ['search_read', 'search_count'],
  'helpdesk.tag': ['search_read'],
  'res.partner': ['search_read', 'search_count', 'read_group'],
  'res.partner.category': ['search_read'],
};

export function isAllowedOperation(model: string, method: string): model is AllowedModel {
  const methods = (ALLOWED_OPERATIONS_BY_MODEL as Record<string, readonly string[]>)[model];
  return methods !== undefined && methods.includes(method);
}

/** Méthodes autorisées pour un modèle donné — utilisé par les messages d'erreur et les tests. */
export function allowedMethodsFor(model: string): readonly AllowedMethod[] {
  return (ALLOWED_OPERATIONS_BY_MODEL as Record<string, readonly AllowedMethod[]>)[model] ?? [];
}

/**
 * Lève OdooOperationNotAllowedError si (model, method) n'est pas dans la matrice
 * fermée ci-dessus. Doit être appelée à la fois côté services et côté client HTTP
 * (défense en profondeur).
 */
export function assertAllowedOperation(model: string, method: string): asserts model is AllowedModel {
  if (!isAllowedOperation(model, method)) {
    throw new OdooOperationNotAllowedError(model, method);
  }
}

/**
 * Liste blanche des champs Odoo pouvant être demandés par modèle.
 *
 * Pour `helpdesk.ticket`, elle a été **confrontée au `fields_get` réel** de
 * l'instance (Odoo 18.0 Enterprise, 112 champs — voir `DIAGNOSTIC-D8.md`) :
 * chaque entrée existe bel et bien sur le modèle. `sale_order_id` et
 * `sale_order_state` en ont été retirés, car ils n'existent pas et faisaient
 * échouer tout appel ne précisant pas `fields` (`DEFAULT_FIELDS` valant la liste
 * complète).
 */
export const ALLOWED_FIELDS: Record<AllowedModel, readonly string[]> = {
  'knowledge.article': [
    'id',
    'name',
    'article_url',
    'website_url',
    'is_article_visible_by_everyone',
    'is_locked',
    'is_published',
    'website_published',
    'can_publish',
    'active',
    'parent_id',
    'internal_permission',
    'inherited_permission',
    'article_member_ids',
    'user_has_access',
    'is_article_visible',
    'body',
    'summary',
    'create_date',
    'write_date',
  ],
  // Couverture complète du modèle, relevée par `fields_get` sur la production
  // le 09/09/2026 (Odoo 18.0 Enterprise, 114 champs) — à une exception près,
  // `access_token`, voir EXCLUDED_SENSITIVE_FIELDS ci-dessous.
  //
  // Ces champs sont demandables ; ils ne sont pas tous demandés par défaut
  // (voir DEFAULT_FIELDS), pour que la réponse reste légère et portable d'une
  // instance à l'autre.
  'helpdesk.ticket': [
    // Identité et contenu
    'id', 'name', 'display_name', 'description', 'ticket_ref', 'active', 'color',
    // Classement et cycle de vie
    'priority', 'stage_id', 'kanban_state', 'kanban_state_label', 'fold',
    'legend_blocked', 'legend_done', 'legend_normal', 'date_last_stage_update',
    'closed_by_partner', 'display_extra_info',
    // Affectation
    'user_id', 'team_id', 'team_privacy_visibility', 'domain_user_ids',
    // Client
    'partner_id', 'partner_name', 'partner_email', 'partner_phone',
    'partner_company_name', 'commercial_partner_id', 'partner_ticket_ids',
    'partner_ticket_count', 'partner_open_ticket_count', 'email_cc',
    'is_partner_email_update', 'is_partner_phone_update', 'company_id',
    // Dates et durées
    'create_date', 'write_date', 'create_uid', 'write_uid', 'assign_date',
    'assign_hours', 'close_date', 'close_hours', 'open_hours',
    'first_response_hours', 'avg_response_hours', 'total_response_hours',
    'oldest_unanswered_customer_message_date', 'answered_customer_message_count',
    'duration_tracking',
    // Messagerie et abonnés
    'has_message', 'message_ids', 'message_is_follower', 'message_follower_ids',
    'message_partner_ids', 'message_needaction', 'message_needaction_counter',
    'message_has_error', 'message_has_error_counter', 'message_has_sms_error',
    'message_attachment_count', 'website_message_ids',
    // Activités
    'activity_ids', 'activity_state', 'activity_user_id', 'activity_type_id',
    'activity_type_icon', 'activity_date_deadline', 'my_activity_date_deadline',
    'activity_summary', 'activity_exception_decoration', 'activity_exception_icon',
    'activity_calendar_event_id',
    // Évaluations
    'rating_ids', 'rating_last_value', 'rating_last_feedback', 'rating_last_image',
    'rating_last_text', 'rating_count', 'rating_avg', 'rating_avg_text',
    'rating_percentage_satisfaction', 'use_rating',
    // SLA
    'sla_ids', 'sla_status_ids', 'sla_deadline', 'sla_deadline_hours',
    'sla_reached', 'sla_reached_late', 'sla_fail', 'sla_success', 'use_sla',
    // Provenance et portail
    'campaign_id', 'source_id', 'medium_id', 'access_url', 'access_warning',
    // Modules optionnels (voir INSTANCE_CONDITIONAL_FIELDS)
    'sale_order_id', 'sale_order_state', 'use_credit_notes', 'use_coupons',
    'use_product_returns', 'use_product_repairs',
    // Divers
    'properties', 'tag_ids',
    // Champs Studio propres à Scolares. `x_studio_produit` est l'axe de
    // catégorisation métier réellement utilisé (le modèle n'a ni
    // `ticket_type_id` ni `category_id`) — voir DIAGNOSTIC-D8.md §4.
    'x_studio_produit', 'x_studio_fonction', 'x_studio_etablissement',
    'x_studio_etablissement_1', 'x_studio_n_fase', 'x_studio_fase_tabl',
    'x_studio_char_field_Y5sfB', 'x_studio_one2many_field_57PYT',
  ],
  'mail.message': [
    'id',
    'body',
    'subject',
    'date',
    'author_id',
    'message_type',
    'model',
    'res_id',
    'record_name',
    'attachment_ids',
    'subtype_id',
    'partner_ids',
    'email_from',
    'create_uid',
    'create_date',
    'write_date',
    'parent_id',
    'reply_to',
    'is_internal',
    'starred_partner_ids',
  ],
  // Strict nécessaire : `member_ids` (données personnelles) est délibérément absent.
  'helpdesk.team': ['id', 'name', 'display_name', 'company_id', 'active'],
  'helpdesk.tag': ['id', 'name', 'color'],

  /**
   * `res.partner` compte 192 champs sur cette instance (254 sur le relevé de
   * référence, qui décrit une autre base — voir CONTACTS-lot1-correspondance.md §7).
   *
   * La sélection est une **liste blanche explicite**, jamais une exclusion : une
   * liste noire laisserait passer tout champ ajouté plus tard dans Studio.
   *
   * Sont délibérément absents : les 44 champs comptables, bancaires et de
   * facturation (`vat`, `bank_ids`, `debit_limit`, `property_account_*`,
   * `invoice_ids`, `payment_token_ids`…), les 12 champs binaires (images,
   * avatars) et les variantes `x_studio_*_1`, mesurées **intégralement vides**.
   */
  'res.partner': [
    // Identité
    'id', 'name', 'complete_name', 'display_name', 'ref', 'is_company',
    'company_type', 'active', 'lang',
    // Identifiants école
    'x_studio_fase', 'x_studio_edid', 'x_studio_id_cabanga',
    // Rattachement au pouvoir organisateur (textuel : `parent_id` est vide sur
    // toutes les sociétés — voir CONTACTS-lot1-correspondance.md §5)
    'x_studio_fase_po', 'x_studio_nom_du_po', 'x_studio_appartient_po_multi_cole',
    'parent_id', 'commercial_partner_id', 'child_ids',
    // Segmentation
    'x_studio_rseau', 'x_studio_niveau', 'x_studio_diocse', 'x_studio_entit',
    'x_studio_nombre_dlves', 'industry_id', 'category_id',
    // Équipement et licences
    'x_studio_license_proeco', 'x_studio_licence_compteco', 'x_studio_licence_edt',
    'x_studio_proeco_5_v2', 'x_studio_date_dactivation_v2',
    'x_studio_module_frais', 'x_studio_activation_frais',
    'x_studio_module_sms', 'x_studio_activation_module_sms',
    'x_studio_logiciel_comptable', 'x_studio_serveur_cloud', 'x_studio_serveur_net',
    'x_studio_mise_en_prod_pes',
    // Coordonnées
    'email', 'phone', 'mobile', 'website', 'function',
    'street', 'street2', 'zip', 'city', 'state_id', 'country_id',
    'x_studio_email_economat',
    // Traçabilité
    'create_date', 'write_date',
  ],
  'res.partner.category': ['id', 'name', 'color'],
};

/**
 * Champs volontairement **hors** liste blanche, malgré leur présence sur le modèle.
 *
 * `access_token` est le jeton de sécurité du portail : combiné à `access_url`
 * (`/my/ticket/<id>`), il ouvre le ticket sans authentification. Le faire
 * transiter par un outil MCP reviendrait à déverser des jetons d'accès dans le
 * contexte d'un modèle et dans les journaux. `access_url` seul, lui, est exposé.
 */
export const EXCLUDED_SENSITIVE_FIELDS: Record<string, string> = {
  access_token: "jeton d'accès portail — exposerait un accès non authentifié au ticket",
};

/**
 * Champs qui n'existent que sur certaines instances, selon les modules installés.
 * Les demander par défaut ferait échouer l'appel entier là où ils sont absents
 * (`Invalid field ... on model 'helpdesk.ticket'`) : ils restent demandables
 * explicitement, jamais inclus d'office.
 *
 * Constaté le 09/09/2026 : présents sur `scolares` (production), absents de la
 * copie `scolares-test-20260902`.
 */
export const INSTANCE_CONDITIONAL_FIELDS: readonly string[] = [
  'sale_order_id',
  'sale_order_state',
];

/**
 * Champs demandés à Odoo quand l'appelant n'en précise aucun.
 *
 * Volontairement **plus étroit** que `ALLOWED_FIELDS` pour `helpdesk.ticket` :
 * la liste complète (113 champs) embarquerait des tableaux d'identifiants non
 * bornés (`partner_ticket_ids`, `domain_user_ids`…), un binaire
 * (`rating_last_image`), des blobs JSON (`properties`, `duration_tracking`) et
 * des champs absents de certaines instances. Tout cela reste demandable via
 * `fields`, mais n'est plus imposé à qui ne demande rien.
 */
const HELPDESK_DEFAULT_FIELDS: readonly string[] = [
  'id',
  'name',
  'display_name',
  'description',
  'priority',
  'stage_id',
  'kanban_state',
  'user_id',
  'team_id',
  'partner_id',
  'partner_name',
  'partner_email',
  'partner_phone',
  'company_id',
  'create_date',
  'write_date',
  'assign_date',
  'close_date',
  'date_last_stage_update',
  'close_hours',
  'open_hours',
  'has_message',
  'message_ids',
  'activity_state',
  'activity_date_deadline',
  'activity_summary',
  'ticket_ref',
  'tag_ids',
  'access_url',
  'x_studio_produit',
  'x_studio_fonction',
  'x_studio_etablissement',
];

/**
 * Profil « court » de `res.partner` : identité, FASE, segmentation, ville.
 * C'est ce qui est demandé quand l'appelant ne précise rien — le profil complet
 * (`ALLOWED_FIELDS`) reste accessible via `profile: "full"` ou `fields`.
 */
export const PARTNER_SHORT_FIELDS: readonly string[] = [
  'id',
  'name',
  'ref',
  'is_company',
  'active',
  'x_studio_fase',
  'x_studio_fase_po',
  'x_studio_rseau',
  'x_studio_niveau',
  'x_studio_nombre_dlves',
  'city',
  'zip',
];

export const DEFAULT_FIELDS: Record<AllowedModel, readonly string[]> = {
  ...ALLOWED_FIELDS,
  'helpdesk.ticket': HELPDESK_DEFAULT_FIELDS,
  'res.partner': PARTNER_SHORT_FIELDS,
};

/**
 * Champs **réellement présents** sur `helpdesk.ticket`, relevés par `fields_get`
 * sur la production `scolares` le 09/09/2026 (Odoo 18.0 Enterprise, 114 champs
 * — voir `DIAGNOSTIC-D8.md`). Sert uniquement à distinguer, dans la réponse, un
 * champ que ce serveur n'expose pas d'un champ qui n'existe pas du tout en base.
 *
 * `fields_get` n'est volontairement pas ajouté à la liste blanche du runtime :
 * l'introspection a eu lieu une fois, à la conception. Si le modèle Odoo évolue,
 * le pire cas est qu'un champ soit étiqueté « inconnu » au lieu de
 * « non exposé » — jamais un blocage.
 */
const KNOWN_ODOO_FIELDS: Partial<Record<AllowedModel, readonly string[]>> = {
  'helpdesk.ticket': [
    'access_token', 'access_url', 'access_warning', 'active',
    'activity_calendar_event_id', 'activity_date_deadline', 'activity_exception_decoration', 'activity_exception_icon',
    'activity_ids', 'activity_state', 'activity_summary', 'activity_type_icon',
    'activity_type_id', 'activity_user_id', 'answered_customer_message_count', 'assign_date',
    'assign_hours', 'avg_response_hours', 'campaign_id', 'close_date',
    'close_hours', 'closed_by_partner', 'color', 'commercial_partner_id',
    'company_id', 'create_date', 'create_uid', 'date_last_stage_update',
    'description', 'display_extra_info', 'display_name', 'domain_user_ids',
    'duration_tracking', 'email_cc', 'first_response_hours', 'fold',
    'has_message', 'id', 'is_partner_email_update', 'is_partner_phone_update',
    'kanban_state', 'kanban_state_label', 'legend_blocked', 'legend_done',
    'legend_normal', 'medium_id', 'message_attachment_count', 'message_follower_ids',
    'message_has_error', 'message_has_error_counter', 'message_has_sms_error', 'message_ids',
    'message_is_follower', 'message_needaction', 'message_needaction_counter', 'message_partner_ids',
    'my_activity_date_deadline', 'name', 'oldest_unanswered_customer_message_date', 'open_hours',
    'partner_company_name', 'partner_email', 'partner_id', 'partner_name',
    'partner_open_ticket_count', 'partner_phone', 'partner_ticket_count', 'partner_ticket_ids',
    'priority', 'properties', 'rating_avg', 'rating_avg_text',
    'rating_count', 'rating_ids', 'rating_last_feedback', 'rating_last_image',
    'rating_last_text', 'rating_last_value', 'rating_percentage_satisfaction',
    'sale_order_id', 'sale_order_state', 'sla_deadline',
    'sla_deadline_hours', 'sla_fail', 'sla_ids', 'sla_reached',
    'sla_reached_late', 'sla_status_ids', 'sla_success', 'source_id',
    'stage_id', 'tag_ids', 'team_id', 'team_privacy_visibility',
    'ticket_ref', 'total_response_hours', 'use_coupons', 'use_credit_notes',
    'use_product_repairs', 'use_product_returns', 'use_rating', 'use_sla',
    'user_id', 'website_message_ids', 'write_date', 'write_uid',
    'x_studio_char_field_Y5sfB', 'x_studio_etablissement', 'x_studio_etablissement_1', 'x_studio_fase_tabl',
    'x_studio_fonction', 'x_studio_n_fase', 'x_studio_one2many_field_57PYT', 'x_studio_produit',
  ],
};

/** Pourquoi un champ demandé n'a pas été transmis à Odoo. */
export type IgnoredFieldReason =
  /** Le champ existe sur le modèle Odoo, mais ce serveur ne l'expose pas. */
  | 'non_expose'
  /** Le champ n'existe pas sur le modèle Odoo. */
  | 'inconnu';

export interface IgnoredField {
  field: string;
  reason: IgnoredFieldReason;
}

export interface FilteredFields {
  fields: string[];
  /** Noms seuls, forme historique conservée pour les appelants existants. */
  ignoredFields: string[];
  /** Même information, avec le motif du rejet. */
  ignoredFieldsDetail: IgnoredField[];
}

function explainIgnored(model: AllowedModel, field: string): IgnoredFieldReason {
  const known = KNOWN_ODOO_FIELDS[model];
  if (known === undefined) {
    // Modèle dont les champs réels n'ont pas été relevés : ne rien affirmer.
    return 'non_expose';
  }
  return known.includes(field) ? 'non_expose' : 'inconnu';
}

/**
 * Filtre une liste de champs demandés par le client MCP contre la liste blanche
 * du modèle. Les champs hors liste blanche sont retirés et reportés dans
 * `ignoredFields` / `ignoredFieldsDetail` plutôt que de bloquer l'appel.
 */
export function filterAllowedFields(model: AllowedModel, requested?: string[]): FilteredFields {
  if (!requested || requested.length === 0) {
    return { fields: [...DEFAULT_FIELDS[model]], ignoredFields: [], ignoredFieldsDetail: [] };
  }
  const allowed = new Set(ALLOWED_FIELDS[model]);
  const fields: string[] = [];
  const ignoredFields: string[] = [];
  const ignoredFieldsDetail: IgnoredField[] = [];
  for (const field of requested) {
    if (allowed.has(field)) {
      fields.push(field);
    } else {
      ignoredFields.push(field);
      ignoredFieldsDetail.push({ field, reason: explainIgnored(model, field) });
    }
  }
  if (fields.length === 0) {
    return { fields: [...DEFAULT_FIELDS[model]], ignoredFields, ignoredFieldsDetail };
  }
  return { fields, ignoredFields, ignoredFieldsDetail };
}

/**
 * Union des champs demandés et d'un socle toujours nécessaire, en préservant
 * l'ordre et sans doublon. Permet à `fields: ["id"]` de continuer à porter
 * l'équipe, le produit et les étiquettes en sortie.
 */
export function withBaseFields(fields: string[], base: readonly string[]): string[] {
  return [...new Set([...fields, ...base])];
}

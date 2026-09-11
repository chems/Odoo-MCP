/**
 * Compare la liste de champs fournie (relevé `fields_get` de référence) avec :
 *  - les champs réellement présents sur l'instance connectée,
 *  - la liste blanche du serveur (`ALLOWED_FIELDS`).
 *
 * Mesure aussi le poids de chaque champ candidat sur des tickets réels, pour
 * décider lesquels peuvent entrer dans les champs demandés par défaut.
 *
 * LECTURE SEULE.  npx tsx --env-file=.env scripts/diff-champs.ts
 */
import axios from 'axios';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ALLOWED_FIELDS } from '../src/security/whitelist.js';
import path from 'node:path';

/** Rapport écrit dans DIAGNOSTIC_OUT_DIR, ou dans ./tmp à la racine du projet. */
function resolveOut(nom: string): string {
  const dossier = process.env.DIAGNOSTIC_OUT_DIR ?? path.join(process.cwd(), 'tmp');
  mkdirSync(dossier, { recursive: true });
  return path.join(dossier, nom);
}

const ODOO_BASE_URL = process.env.ODOO_BASE_URL?.replace(/\/+$/, '');
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = Number(process.env.ODOO_UID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

/** Relevé de référence fourni le 09/09/2026 (production). */
const REFERENCE: Record<string, string> = {
  duration_tracking: 'json', activity_ids: 'one2many', activity_state: 'selection',
  activity_user_id: 'many2one', activity_type_id: 'many2one', activity_type_icon: 'char',
  activity_date_deadline: 'date', my_activity_date_deadline: 'date', activity_summary: 'char',
  activity_exception_decoration: 'selection', activity_exception_icon: 'char',
  activity_calendar_event_id: 'many2one', message_is_follower: 'boolean',
  message_follower_ids: 'one2many', message_partner_ids: 'many2many', message_ids: 'one2many',
  has_message: 'boolean', message_needaction: 'boolean', message_needaction_counter: 'integer',
  message_has_error: 'boolean', message_has_error_counter: 'integer',
  message_attachment_count: 'integer', rating_ids: 'one2many', website_message_ids: 'one2many',
  message_has_sms_error: 'boolean', rating_last_value: 'float', rating_last_feedback: 'text',
  rating_last_image: 'binary', rating_count: 'integer', rating_avg: 'float',
  rating_avg_text: 'selection', rating_percentage_satisfaction: 'float', rating_last_text: 'selection',
  campaign_id: 'many2one', source_id: 'many2one', medium_id: 'many2one', email_cc: 'char',
  access_url: 'char', access_token: 'char', access_warning: 'text', name: 'char',
  team_id: 'many2one', use_sla: 'boolean', team_privacy_visibility: 'selection',
  description: 'html', active: 'boolean', tag_ids: 'many2many', company_id: 'many2one',
  color: 'integer', kanban_state: 'selection', kanban_state_label: 'char',
  legend_blocked: 'char', legend_done: 'char', legend_normal: 'char',
  domain_user_ids: 'many2many', user_id: 'many2one', properties: 'properties',
  partner_id: 'many2one', partner_ticket_ids: 'many2many', partner_ticket_count: 'integer',
  partner_open_ticket_count: 'integer', partner_name: 'char', partner_email: 'char',
  partner_phone: 'char', commercial_partner_id: 'many2one', closed_by_partner: 'boolean',
  priority: 'selection', stage_id: 'many2one', fold: 'boolean',
  date_last_stage_update: 'datetime', ticket_ref: 'char', assign_date: 'datetime',
  assign_hours: 'float', close_date: 'datetime', close_hours: 'float', open_hours: 'integer',
  sla_ids: 'many2many', sla_status_ids: 'one2many', sla_reached_late: 'boolean',
  sla_reached: 'boolean', sla_deadline: 'datetime', sla_deadline_hours: 'float',
  sla_fail: 'boolean', sla_success: 'boolean', use_credit_notes: 'boolean',
  use_coupons: 'boolean', use_product_returns: 'boolean', use_product_repairs: 'boolean',
  use_rating: 'boolean', is_partner_email_update: 'boolean', is_partner_phone_update: 'boolean',
  first_response_hours: 'float', avg_response_hours: 'float',
  oldest_unanswered_customer_message_date: 'datetime', answered_customer_message_count: 'integer',
  total_response_hours: 'float', display_extra_info: 'boolean', id: 'integer',
  display_name: 'char', create_uid: 'many2one', create_date: 'datetime',
  write_uid: 'many2one', write_date: 'datetime', partner_company_name: 'char',
  sale_order_id: 'many2one', sale_order_state: 'selection', x_studio_produit: 'selection',
  x_studio_fonction: 'selection', x_studio_n_fase: 'char', x_studio_char_field_Y5sfB: 'char',
  x_studio_etablissement: 'char', x_studio_etablissement_1: 'many2one', x_studio_fase_tabl: 'char',
};

async function odooCall(model: string, method: string, args: unknown[], kwargs = {}): Promise<unknown> {
  if (!['search_read', 'fields_get', 'search_count'].includes(method)) {
    throw new Error(`Méthode non autorisée : ${method}`);
  }
  const { data } = await axios.post(
    `${ODOO_BASE_URL}/jsonrpc`,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
      },
      id: Date.now(),
    },
    { timeout: 60000, headers: { 'Content-Type': 'application/json' } },
  );
  if (data?.error) {
    const d = data.error?.data ?? data.error;
    throw new Error(`[${d?.name ?? '?'}] ${d?.message ?? data.error.message}`);
  }
  return data?.result;
}

async function main() {
  const reference = Object.keys(REFERENCE).sort();
  const surInstance = Object.keys(
    (await odooCall('helpdesk.ticket', 'fields_get', [[], ['type']])) as Record<string, unknown>,
  ).sort();
  const whitelist = [...ALLOWED_FIELDS['helpdesk.ticket']].sort();

  console.log(`Référence fournie      : ${reference.length} champs`);
  console.log(`Instance ${ODOO_DB} : ${surInstance.length} champs`);
  console.log(`Liste blanche actuelle : ${whitelist.length} champs`);

  const absentsDeLInstance = reference.filter((f) => !surInstance.includes(f));
  const absentsDeLaReference = surInstance.filter((f) => !reference.includes(f));
  const manquantsDansWhitelist = reference.filter((f) => !whitelist.includes(f));

  console.log('\n=== Divergence entre la référence et l\'instance connectée ===');
  console.log('Dans la référence mais PAS sur cette instance :', absentsDeLInstance.join(', ') || '(aucun)');
  console.log('Sur cette instance mais PAS dans la référence :', absentsDeLaReference.join(', ') || '(aucun)');

  console.log(`\n=== ${manquantsDansWhitelist.length} champs de la référence absents de la liste blanche ===`);
  for (const f of manquantsDansWhitelist) {
    console.log(`  ${f.padEnd(42)} ${REFERENCE[f]}`);
  }

  // Poids réel de chaque champ candidat, sur des tickets représentatifs.
  console.log('\n=== Poids mesuré par champ (moyenne sur 10 tickets) ===');
  const testables = manquantsDansWhitelist.filter((f) => surInstance.includes(f));
  const poids: { champ: string; type: string; octets: number; exemple: string }[] = [];

  for (const champ of testables) {
    try {
      const rows = (await odooCall('helpdesk.ticket', 'search_read', [[['team_id', '=', 27]]], {
        fields: ['id', champ],
        limit: 10,
        order: 'id desc',
      })) as Record<string, unknown>[];
      const octets = Math.round(
        rows.reduce((s, r) => s + Buffer.byteLength(JSON.stringify(r[champ] ?? null), 'utf8'), 0) / rows.length,
      );
      const brut = JSON.stringify(rows.find((r) => r[champ] !== false && r[champ] !== null)?.[champ] ?? null);
      poids.push({ champ, type: REFERENCE[champ]!, octets, exemple: brut.slice(0, 70) });
    } catch (err) {
      poids.push({
        champ,
        type: REFERENCE[champ]!,
        octets: -1,
        exemple: err instanceof Error ? err.message.slice(0, 60) : '?',
      });
    }
  }

  for (const p of poids.sort((a, b) => b.octets - a.octets)) {
    console.log(`  ${String(p.octets).padStart(6)} o  ${p.champ.padEnd(42)} ${p.type.padEnd(10)} ${p.exemple}`);
  }

  writeFileSync(
    resolveOut('diff-champs.json'),
    JSON.stringify({ reference, surInstance, whitelist, absentsDeLInstance, manquantsDansWhitelist, poids }, null, 2),
    'utf8',
  );
}

main().catch((e: unknown) => {
  console.error('Échec :', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

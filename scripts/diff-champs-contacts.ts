/**
 * Compare le relevé `fields_get` fourni (fields-contact.json) avec les champs
 * réellement présents sur l'instance connectée. LECTURE SEULE.
 *
 * Même vérification que pour helpdesk.ticket, où deux champs du relevé de
 * référence n'existaient pas sur la copie de test et faisaient échouer tout
 * appel ne précisant pas `fields`.
 *
 *   npx tsx --env-file=.env scripts/diff-champs-contacts.ts
 */
import axios from 'axios';
import { readFileSync } from 'node:fs';

const ODOO_BASE_URL = process.env.ODOO_BASE_URL?.replace(/\/+$/, '');
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = Number(process.env.ODOO_UID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

const REFERENCE_FILE = 'C:\\Users\\MaherChemseddine\\Downloads\\fields-contact.json';

async function odoo(model: string, method: string, args: unknown[], kwargs = {}): Promise<unknown> {
  if (!['fields_get', 'search_count'].includes(method)) throw new Error(`Méthode non autorisée : ${method}`);
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
  const brut = JSON.parse(readFileSync(REFERENCE_FILE, 'utf8')) as {
    result: Record<string, { type?: string; string?: string }>;
  };
  const reference = Object.keys(brut.result).sort();
  const surInstance = Object.keys(
    (await odoo('res.partner', 'fields_get', [[], ['type']])) as Record<string, unknown>,
  ).sort();

  console.log(`Relevé fourni (fields-contact.json) : ${reference.length} champs`);
  console.log(`Instance ${ODOO_DB} : ${surInstance.length} champs\n`);

  const absentsDeLInstance = reference.filter((f) => !surInstance.includes(f));
  const absentsDeLaReference = surInstance.filter((f) => !reference.includes(f));

  console.log(`=== ${absentsDeLInstance.length} champs du relevé ABSENTS de cette instance ===`);
  console.log('(les demander ferait échouer l\'appel entier)\n');
  for (const f of absentsDeLInstance) {
    console.log(`  ${f.padEnd(46)} ${brut.result[f]?.type ?? '?'}  — ${brut.result[f]?.string ?? ''}`);
  }

  console.log(`\n=== ${absentsDeLaReference.length} champs de l'instance absents du relevé ===`);
  for (const f of absentsDeLaReference) console.log(`  ${f}`);

  // Les champs métier que le plan veut exposer sont-ils tous présents ?
  const voulus = [
    'name', 'x_studio_fase', 'x_studio_edid', 'x_studio_id_cabanga', 'ref', 'is_company',
    'parent_id', 'commercial_partner_id', 'x_studio_fase_po', 'x_studio_nom_du_po',
    'x_studio_appartient_po_multi_cole', 'x_studio_rseau', 'x_studio_niveau', 'x_studio_diocse',
    'industry_id', 'category_id', 'x_studio_nombre_dlves', 'x_studio_license_proeco',
    'x_studio_licence_compteco', 'x_studio_licence_edt', 'x_studio_proeco_5_v2',
    'x_studio_module_frais', 'x_studio_module_sms', 'x_studio_logiciel_comptable',
    'x_studio_serveur_cloud', 'x_studio_serveur_net', 'x_studio_date_dactivation_v2',
    'email', 'phone', 'city', 'zip', 'country_id', 'x_studio_email_economat', 'function',
  ];
  const manquants = voulus.filter((f) => !surInstance.includes(f));
  console.log(`\n=== Champs métier visés par le plan (§1.4) : ${voulus.length} ===`);
  console.log(manquants.length === 0 ? '  tous présents sur cette instance' : `  MANQUANTS : ${manquants.join(', ')}`);
}

main().catch((e: unknown) => {
  console.error('Échec :', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

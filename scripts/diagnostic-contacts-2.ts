/**
 * Lot 1, complément : taux de remplissage des champs métier visés par le plan
 * (§1.4), et statut des deux anomalies Studio (§1.2). LECTURE SEULE.
 *
 *   npx tsx --env-file=.env scripts/diagnostic-contacts-2.ts
 */
import axios from 'axios';
import { mkdirSync, writeFileSync } from 'node:fs';
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

async function odoo(model: string, method: string, args: unknown[], kwargs = {}): Promise<unknown> {
  if (!['search_read', 'search_count', 'read_group'].includes(method)) {
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
    { timeout: 120000, headers: { 'Content-Type': 'application/json' } },
  );
  if (data?.error) {
    const d = data.error?.data ?? data.error;
    throw new Error(`[${d?.name ?? '?'}] ${d?.message ?? data.error.message}`);
  }
  return data?.result;
}

const SOCIETE = ['is_company', '=', true];
const count = (domain: unknown[]) => odoo('res.partner', 'search_count', [domain]) as Promise<number>;

/** nom métier → champ Odoo, tels que proposés pour le service. */
const CORRESPONDANCE: [string, string][] = [
  ['fase', 'x_studio_fase'],
  ['fasePo', 'x_studio_fase_po'],
  ['nomPo', 'x_studio_nom_du_po'],
  ['edid', 'x_studio_edid'],
  ['idCabanga', 'x_studio_id_cabanga'],
  ['reference', 'ref'],
  ['reseau', 'x_studio_rseau'],
  ['niveau', 'x_studio_niveau'],
  ['diocese', 'x_studio_diocse'],
  ['entite', 'x_studio_entit'],
  ['nombreEleves', 'x_studio_nombre_dlves'],
  ['appartientPoMultiEcole', 'x_studio_appartient_po_multi_cole'],
  ['licenceProeco', 'x_studio_license_proeco'],
  ['licenceComptEco', 'x_studio_licence_compteco'],
  ['licenceEdt', 'x_studio_licence_edt'],
  ['proeco5v2', 'x_studio_proeco_5_v2'],
  ['dateActivationV2', 'x_studio_date_dactivation_v2'],
  ['moduleFrais', 'x_studio_module_frais'],
  ['moduleSms', 'x_studio_module_sms'],
  ['logicielComptable', 'x_studio_logiciel_comptable'],
  ['serveurCloud', 'x_studio_serveur_cloud'],
  ['serveurNet', 'x_studio_serveur_net'],
  ['emailEconomat', 'x_studio_email_economat'],
  ['parent', 'parent_id'],
  ['entiteCommerciale', 'commercial_partner_id'],
  ['secteur', 'industry_id'],
  ['etiquettes', 'category_id'],
  ['email', 'email'],
  ['telephone', 'phone'],
  ['ville', 'city'],
  ['codePostal', 'zip'],
  ['pays', 'country_id'],
  ['fonction', 'function'],
];

/** Anomalies à statuer (§1.2 du plan). */
const ANOMALIES = ['x_studio_fase_index_1', 'x_studio_char_field_P9tBM'];

async function main() {
  const rapport: Record<string, unknown> = { date: new Date().toISOString(), db: ODOO_DB };
  const totalSocietes = await count([SOCIETE]);
  console.log(`${totalSocietes} sociétés\n`);

  console.log('=== Taux de remplissage des champs à exposer (sociétés) ===');
  console.log('nom métier'.padEnd(26) + 'champ Odoo'.padEnd(38) + 'remplis'.padStart(8) + '  taux');
  const lignes: Record<string, unknown>[] = [];
  for (const [metier, odooField] of CORRESPONDANCE) {
    const n = await count([SOCIETE, [odooField, '!=', false]]);
    const taux = Math.round((n / totalSocietes) * 100);
    console.log(
      metier.padEnd(26) + odooField.padEnd(38) + String(n).padStart(8) + `  ${String(taux).padStart(3)}%`,
    );
    lignes.push({ metier, odooField, remplis: n, taux });
  }
  rapport.correspondance = lignes;

  console.log('\n=== Anomalies Studio (§1.2) ===');
  const anomalies: Record<string, unknown>[] = [];
  for (const champ of ANOMALIES) {
    try {
      const n = await count([SOCIETE, [champ, '!=', false]]);
      console.log(`  ${champ.padEnd(34)} ${String(n).padStart(5)} sociétés renseignées`);
      anomalies.push({ champ, remplis: n });
    } catch (err) {
      console.log(`  ${champ.padEnd(34)} ABSENT — ${err instanceof Error ? err.message.slice(0, 50) : ''}`);
      anomalies.push({ champ, remplis: null, absent: true });
    }
  }
  rapport.anomalies = anomalies;

  console.log('\n=== Lexique réel : effectifs par réseau et par niveau ===');
  for (const axe of ['x_studio_rseau', 'x_studio_niveau', 'x_studio_logiciel_comptable']) {
    const groupes = (await odoo('res.partner', 'read_group', [[SOCIETE], ['id'], [axe]], {
      lazy: false,
      limit: 50,
    })) as Record<string, unknown>[];
    console.log(`\n  ${axe} :`);
    for (const g of groupes.sort((a, b) => (b.__count as number) - (a.__count as number))) {
      const v = g[axe];
      console.log(`    ${String(g.__count).padStart(5)}  ${v === false ? '(non renseigné)' : String(v)}`);
    }
    rapport[`lexique_${axe}`] = groupes.map((g) => ({ valeur: g[axe], count: g.__count }));
  }

  // FASE non unique : combien de sociétés partagent un même numéro ?
  console.log('\n=== FASE : unicité ===');
  const rows = (await odoo('res.partner', 'search_read', [[SOCIETE, ['x_studio_fase', '!=', false]]], {
    fields: ['id', 'name', 'x_studio_fase'],
    limit: 3000,
    order: 'id asc',
  })) as Record<string, unknown>[];
  const parFase = new Map<string, { id: number; name: string }[]>();
  for (const r of rows) {
    const k = String(r.x_studio_fase);
    if (!parFase.has(k)) parFase.set(k, []);
    parFase.get(k)!.push({ id: r.id as number, name: r.name as string });
  }
  const partages = [...parFase.entries()].filter(([, v]) => v.length > 1);
  console.log(`  ${parFase.size} FASE distincts pour ${rows.length} sociétés`);
  console.log(`  ${partages.length} FASE portés par plusieurs sociétés :`);
  for (const [fase, societes] of partages.slice(0, 8)) {
    console.log(`    ${fase.padEnd(12)} ${societes.map((s) => `#${s.id} ${s.name}`).join(' | ').slice(0, 110)}`);
  }
  rapport.faseUnicite = {
    distincts: parFase.size,
    societesAvecFase: rows.length,
    fasePartages: partages.map(([fase, s]) => ({ fase, societes: s })),
  };

  writeFileSync(
    resolveOut('diagnostic-contacts-2.json'),
    JSON.stringify(rapport, null, 2),
    'utf8',
  );
}

main().catch((e: unknown) => {
  console.error('Échec :', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

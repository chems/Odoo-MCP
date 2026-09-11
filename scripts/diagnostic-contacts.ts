/**
 * Lot 1 du plan « service Contacts » — mesures préalables, AUCUN code de service.
 *
 * Objet : trancher, chiffres à l'appui, laquelle des variantes `x_studio_*` /
 * `x_studio_*_1` fait foi, et comment les numéros FASE sont réellement stockés.
 *
 * LECTURE SEULE. N'émet que `search_count`, `search_read`, `read_group` et
 * `fields_get`. `res.partner` n'étant pas dans la liste blanche du serveur, ce
 * script parle à Odoo en direct — délibérément, pour ne rien élargir tant que
 * la table de correspondance n'est pas validée.
 *
 *   npx tsx --env-file=.env scripts/diagnostic-contacts.ts
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

const OUT = resolveOut('diagnostic-contacts.json');

const READ_ONLY = new Set(['search_read', 'search_count', 'read_group', 'fields_get']);

async function odoo(model: string, method: string, args: unknown[], kwargs = {}): Promise<unknown> {
  if (!READ_ONLY.has(method)) throw new Error(`Méthode non autorisée : ${method}`);
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

const count = (domain: unknown[]) => odoo('res.partner', 'search_count', [domain]) as Promise<number>;

const rapport: Record<string, unknown> = {};

async function main() {
  rapport.meta = { date: new Date().toISOString(), instance: ODOO_BASE_URL, db: ODOO_DB, uid: ODOO_UID };
  console.log(`Contacts — ${ODOO_BASE_URL} (db ${ODOO_DB}), uid ${ODOO_UID}\n`);

  // === A. Droits de lecture du compte technique ===
  console.log('=== A. Droits de lecture sur res.partner ===');
  const totalPartners = await count([]);
  const totalCompanies = await count([['is_company', '=', true]]);
  const totalPersons = await count([['is_company', '=', false]]);
  const archived = (await odoo('res.partner', 'search_count', [[['active', '=', false]]], {
    context: { active_test: false },
  })) as number;
  console.log(`  ${totalPartners} partenaires — ${totalCompanies} sociétés, ${totalPersons} personnes`);
  console.log(`  ${archived} archivés`);
  rapport.volumetrie = { totalPartners, totalCompanies, totalPersons, archived };

  // === B. Champs réels + énumérations des selection (lot 3) ===
  console.log('\n=== B. fields_get avec les énumérations ===');
  const champs = (await odoo('res.partner', 'fields_get', [
    [],
    ['type', 'string', 'relation', 'selection', 'store'],
  ])) as Record<string, { type?: string; string?: string; selection?: [string, string][]; store?: boolean }>;
  const noms = Object.keys(champs).sort();
  console.log(`  ${noms.length} champs sur res.partner`);
  const studio = noms.filter((n) => n.startsWith('x_studio_'));
  console.log(`  ${studio.length} champs Studio`);

  // === C. Détection AUTOMATIQUE des paires `_1` ===
  console.log('\n=== C. Paires suffixées _1 détectées ===');
  const paires = studio
    .filter((n) => n.endsWith('_1'))
    .map((variante) => ({ base: variante.slice(0, -2), variante }))
    .filter((p) => noms.includes(p.base));
  const orphelins = studio.filter((n) => n.endsWith('_1') && !noms.includes(n.slice(0, -2)));
  console.log(`  ${paires.length} paires complètes, ${orphelins.length} orphelin(s) : ${orphelins.join(', ') || '(aucun)'}`);
  rapport.paires = paires.map((p) => p.base);
  rapport.orphelins = orphelins;

  // === D. Taux de remplissage des deux variantes, sur les sociétés ===
  console.log('\n=== D. Taux de remplissage (sociétés uniquement) ===');
  console.log(
    'champ'.padEnd(34) +
      'type'.padEnd(11) +
      'base'.padStart(7) +
      '_1'.padStart(8) +
      'les2'.padStart(7) +
      'aucun'.padStart(8) +
      '  verdict',
  );

  const mesures: Record<string, unknown>[] = [];
  for (const { base, variante } of paires) {
    const societe = ['is_company', '=', true];
    const [nBase, nVar, nLes2] = await Promise.all([
      count([societe, [base, '!=', false]]),
      count([societe, [variante, '!=', false]]),
      count([societe, [base, '!=', false], [variante, '!=', false]]),
    ]);
    const aucun = totalCompanies - (nBase + nVar - nLes2);

    let verdict: string;
    if (nBase === 0 && nVar === 0) verdict = 'AUCUNE DONNÉE';
    else if (nVar === 0) verdict = 'base fait foi';
    else if (nBase === 0) verdict = '_1 fait foi';
    else if (nBase >= nVar * 5) verdict = 'base domine';
    else if (nVar >= nBase * 5) verdict = '_1 domine';
    else verdict = 'AMBIGU';

    console.log(
      base.padEnd(34) +
        (champs[base]?.type ?? '?').padEnd(11) +
        String(nBase).padStart(7) +
        String(nVar).padStart(8) +
        String(nLes2).padStart(7) +
        String(aucun).padStart(8) +
        '  ' +
        verdict,
    );
    mesures.push({
      base,
      variante,
      type: champs[base]?.type,
      typeVariante: champs[variante]?.type,
      libelle: champs[base]?.string,
      remplisBase: nBase,
      remplisVariante: nVar,
      remplisLesDeux: nLes2,
      remplisAucun: aucun,
      verdict,
    });
  }
  rapport.remplissage = mesures;

  // === E. Divergence quand les deux variantes sont remplies ===
  console.log('\n=== E. Les deux variantes coïncident-elles ? ===');
  const divergences: Record<string, unknown>[] = [];
  for (const m of mesures) {
    const nLes2 = m.remplisLesDeux as number;
    if (nLes2 === 0) continue;
    const base = m.base as string;
    const variante = m.variante as string;
    const rows = (await odoo('res.partner', 'search_read', [
      [['is_company', '=', true], [base, '!=', false], [variante, '!=', false]],
    ], { fields: ['id', 'name', base, variante], limit: 500, order: 'id asc' })) as Record<string, unknown>[];

    const differents = rows.filter((r) => String(r[base]) !== String(r[variante]));
    const pct = rows.length === 0 ? 0 : Math.round((differents.length / rows.length) * 100);
    console.log(
      `  ${base.padEnd(34)} ${String(rows.length).padStart(4)} examinés, ${String(differents.length).padStart(4)} divergents (${pct}%)`,
    );
    if (differents.length > 0) {
      const ex = differents[0]!;
      console.log(`      ex. #${ex.id} « ${ex.name} » : ${JSON.stringify(ex[base])} vs ${JSON.stringify(ex[variante])}`);
    }
    divergences.push({
      base,
      examines: rows.length,
      divergents: differents.length,
      pourcentage: pct,
      exemples: differents.slice(0, 3).map((r) => ({ id: r.id, name: r.name, base: r[base], variante: r[variante] })),
    });
  }
  rapport.divergences = divergences;

  // === F. Énumérations réelles des champs selection utiles ===
  console.log('\n=== F. Valeurs admises des champs selection ===');
  const selectionsUtiles = [
    'x_studio_rseau', 'x_studio_rseau_1', 'x_studio_niveau', 'x_studio_niveau_1',
    'company_type', 'type', 'trust',
  ];
  const enums: Record<string, unknown> = {};
  for (const nom of selectionsUtiles) {
    const sel = champs[nom]?.selection;
    if (!sel) continue;
    enums[nom] = sel;
    console.log(`  ${nom} (${champs[nom]?.string}) : ${sel.map(([v]) => v).join(' | ')}`);
  }
  rapport.enumerations = enums;

  // === G. Format réel des numéros FASE ===
  console.log('\n=== G. Format des numéros FASE ===');
  const champFase = (mesures.find((m) => m.base === 'x_studio_fase')?.remplisVariante as number) >
    (mesures.find((m) => m.base === 'x_studio_fase')?.remplisBase as number)
    ? 'x_studio_fase_1'
    : 'x_studio_fase';
  console.log(`  Variante retenue pour l'échantillon : ${champFase}`);

  const echantillon = (await odoo('res.partner', 'search_read', [
    [['is_company', '=', true], [champFase, '!=', false]],
  ], { fields: ['id', 'name', champFase], limit: 3000, order: 'id asc' })) as Record<string, unknown>[];

  const valeurs = echantillon.map((r) => String(r[champFase] ?? ''));
  const parLongueur: Record<number, number> = {};
  let avecZeroTete = 0;
  let nonNumerique = 0;
  for (const v of valeurs) {
    parLongueur[v.length] = (parLongueur[v.length] ?? 0) + 1;
    if (/^0\d/.test(v)) avecZeroTete += 1;
    if (!/^\d+$/.test(v)) nonNumerique += 1;
  }
  console.log(`  ${valeurs.length} valeurs — longueurs : ${JSON.stringify(parLongueur)}`);
  console.log(`  avec zéro de tête : ${avecZeroTete} — non numériques : ${nonNumerique}`);
  console.log(`  exemples : ${valeurs.slice(0, 12).join(', ')}`);
  if (nonNumerique > 0) {
    console.log(`  non numériques : ${valeurs.filter((v) => !/^\d+$/.test(v)).slice(0, 10).join(' | ')}`);
  }
  const doublons = valeurs.filter((v, i) => valeurs.indexOf(v) !== i);
  console.log(`  FASE en double : ${new Set(doublons).size}`);
  rapport.fase = {
    champEchantillonne: champFase,
    total: valeurs.length,
    parLongueur,
    avecZeroTete,
    nonNumerique,
    fasePartagesParPlusieursSocietes: new Set(doublons).size,
    exemples: valeurs.slice(0, 20),
  };

  // === H. Le piège de la requête d'exemple : entier vs chaîne ===
  console.log('\n=== H. Requête de l\'exemple fourni : ["x_studio_fase", "=", 3003] ===');
  for (const champ of ['x_studio_fase', 'x_studio_fase_1']) {
    if (!noms.includes(champ)) continue;
    const essais: Record<string, number> = {};
    for (const valeur of [3003 as unknown, '3003', '03003']) {
      try {
        essais[JSON.stringify(valeur)] = await count([['is_company', '=', true], [champ, '=', valeur]]);
      } catch (err) {
        essais[JSON.stringify(valeur)] = -1;
        console.log(`    ${champ} = ${JSON.stringify(valeur)} → ERREUR ${err instanceof Error ? err.message : ''}`);
      }
    }
    console.log(`  ${champ} : ${Object.entries(essais).map(([k, v]) => `${k} → ${v}`).join('  |  ')}`);
    (rapport.faseEssais ??= {} as Record<string, unknown>);
    (rapport.faseEssais as Record<string, unknown>)[champ] = essais;
  }

  // === I. Résolution ticket → école (justifie l'option (a) du §0) ===
  console.log('\n=== I. Taux de résolution ticket → école ===');
  try {
    const tickets = (await odoo('helpdesk.ticket', 'search_read', [[]], {
      fields: ['id', 'partner_id'],
      limit: 1000,
      order: 'id desc',
    })) as Record<string, unknown>[];
    const avecPartner = tickets.filter((t) => Array.isArray(t.partner_id));
    const partnerIds = [...new Set(avecPartner.map((t) => (t.partner_id as [number, string])[0]))];

    const partenaires = (await odoo('res.partner', 'search_read', [[['id', 'in', partnerIds]]], {
      fields: ['id', 'is_company', 'parent_id', champFase],
      limit: partnerIds.length,
    })) as Record<string, unknown>[];
    const parId = new Map(partenaires.map((p) => [p.id as number, p]));

    let avecFaseDirect = 0;
    let viaParent = 0;
    for (const t of avecPartner) {
      const p = parId.get((t.partner_id as [number, string])[0]);
      if (!p) continue;
      if (p[champFase] !== false && p[champFase] != null) avecFaseDirect += 1;
      else if (Array.isArray(p.parent_id)) viaParent += 1;
    }
    const pct = (n: number) => `${Math.round((n / tickets.length) * 100)}%`;
    console.log(`  ${tickets.length} tickets récents examinés`);
    console.log(`  avec partner_id           : ${avecPartner.length} (${pct(avecPartner.length)})`);
    console.log(`  dont FASE directement     : ${avecFaseDirect} (${pct(avecFaseDirect)})`);
    console.log(`  dont rattachés à un parent: ${viaParent} (${pct(viaParent)})`);
    rapport.resolutionTicketEcole = {
      ticketsExamines: tickets.length,
      avecPartner: avecPartner.length,
      avecFaseDirect,
      viaParent,
    };
  } catch (err) {
    console.log(`  ÉCHEC : ${err instanceof Error ? err.message : String(err)}`);
  }

  writeFileSync(OUT, JSON.stringify(rapport, null, 2), 'utf8');
  console.log(`\nRapport complet : ${OUT}`);
}

main().catch((e: unknown) => {
  console.error('\nÉchec :', e instanceof Error ? e.message : String(e));
  writeFileSync(OUT, JSON.stringify(rapport, null, 2), 'utf8');
  process.exit(1);
});

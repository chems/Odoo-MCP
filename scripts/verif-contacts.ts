/**
 * Vérification de bout en bout du service Contacts, contre l'instance réelle.
 * LECTURE SEULE : passe par les services, donc par la liste blanche.
 *
 *   npx tsx --env-file=.env scripts/verif-contacts.ts
 */
import { OdooClient } from '../src/clients/odooClient.js';
import {
  computeContactStats,
  getContact,
  listContactFieldValues,
  resolveSchoolFromTicket,
  searchSchools,
} from '../src/services/contactService.js';
import {
  ContactStatsSchema,
  GetContactSchema,
  ListContactFieldValuesSchema,
  SearchSchoolsSchema,
} from '../src/schemas/contacts.js';

const client = new OdooClient();
let echecs = 0;

function verifier(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '  OK  ' : ' ECHEC'} ${label} — ${detail}`);
  if (!ok) echecs += 1;
}

async function main() {
  // --- La question qui a motivé le chantier : FASE → nom d'école ---
  console.log("=== FASE → nom d'école (la question d'origine) ===");
  const parFase = await getContact(client, GetContactSchema.parse({ fase: 3003 }));
  verifier(
    'FASE 3003 résolu',
    parFase.count >= 1,
    `${parFase.count} fiche(s) — ${parFase.results.map((r) => r.nom).join(' | ')}`,
  );
  console.log(`        réseau : ${parFase.results[0]?.reseau} · niveau : ${parFase.results[0]?.niveau}`);
  console.log(`        élèves : ${parFase.results[0]?.nombreEleves} · ville : ${parFase.results[0]?.contact?.ville ?? 'n/a'}`);

  const enChaine = await getContact(client, GetContactSchema.parse({ fase: '3003' }));
  verifier(
    'entier et chaîne donnent le même résultat',
    JSON.stringify(enChaine.results.map((r) => r.id)) === JSON.stringify(parFase.results.map((r) => r.id)),
    `${enChaine.results[0]?.id} == ${parFase.results[0]?.id}`,
  );

  // --- FASE non unique ---
  console.log('\n=== FASE partagé par plusieurs fiches ===');
  const partage = await getContact(client, GetContactSchema.parse({ fase: 541 }));
  verifier(
    'renvoie une liste, pas une fiche',
    partage.count > 1,
    `${partage.count} fiches — ${partage.results.map((r) => `#${r.id} ${r.nom}`).join(' | ')}`,
  );
  verifier(
    'signale la multiplicité',
    partage.notes.some((n) => n.includes('portent ce FASE')),
    partage.notes.find((n) => n.includes('portent ce FASE'))?.slice(0, 80) ?? '(aucune note)',
  );

  // --- FASE composite ---
  console.log('\n=== FASE composite ===');
  const composite = await searchSchools(client, SearchSchoolsSchema.parse({ fase: 5448 }));
  verifier(
    'une moitié de FASE composite retrouve la fiche',
    composite.total >= 1,
    `${composite.total} correspondance(s) — ${composite.results.map((r) => `${r.fase} ${r.nom}`).join(' | ').slice(0, 90)}`,
  );

  // --- Message d'échec instructif ---
  console.log("\n=== Message d'échec instructif ===");

  // Trouver un FASE de P.O. qui n'est PAS lui-même un FASE d'école : c'est le
  // cas où l'appelant se trompe de filtre sans s'en rendre compte.
  const candidats = await client.searchRead({
    model: 'res.partner',
    method: 'search_read',
    domain: [['is_company', '=', true], ['x_studio_fase_po', '!=', false]],
    fields: ['x_studio_fase_po'],
    limit: 200,
    order: 'id asc',
  });
  let faseDePoSeul: string | null = null;
  for (const c of candidats) {
    const v = String(c.x_studio_fase_po);
    const commeEcole = await client.searchCount({
      model: 'res.partner',
      domain: [['is_company', '=', true], ['x_studio_fase', '=', v]],
    });
    if (commeEcole === 0) {
      faseDePoSeul = v;
      break;
    }
  }

  if (faseDePoSeul === null) {
    console.log('  (aucun FASE de P.O. distinct trouvé dans l’échantillon — cas non testable ici)');
  } else {
    try {
      await getContact(client, GetContactSchema.parse({ fase: faseDePoSeul }));
      verifier(`FASE de P.O. ${faseDePoSeul} rejeté avec explication`, false, 'aucune erreur levée');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      verifier(
        `explique que ${faseDePoSeul} est un FASE de P.O.`,
        msg.includes('fasePo'),
        msg.slice(0, 140),
      );
    }
  }

  // FASE totalement inexistant : le message doit rester informatif.
  try {
    await getContact(client, GetContactSchema.parse({ fase: 99999999 }));
    verifier('FASE inexistant rejeté', false, 'aucune erreur levée');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    verifier('FASE inexistant : message explicite', msg.includes('formes essayées'), msg.slice(0, 120));
  }

  // --- Recherche par nom ---
  console.log('\n=== Recherche par nom ===');
  const parNom = await searchSchools(client, SearchSchoolsSchema.parse({ nom: 'sainte marie' }));
  verifier('« sainte marie » trouve des écoles', parNom.total > 0, `${parNom.total} correspondances`);
  console.log(`        ex. ${parNom.results.slice(0, 3).map((r) => r.nom).join(' | ')}`);

  // --- Pagination déterministe ---
  console.log('\n=== Tri déterministe ===');
  const p1 = await searchSchools(client, SearchSchoolsSchema.parse({ reseau: 'Libre SeGEC', limit: 50, offset: 0 }));
  const p2 = await searchSchools(client, SearchSchoolsSchema.parse({ reseau: 'Libre SeGEC', limit: 50, offset: 50 }));
  const ids = [...p1.results, ...p2.results].map((r) => r.id);
  verifier('100 fiches distinctes sur deux pages', new Set(ids).size === 100, `${new Set(ids).size} ids uniques`);
  verifier('count ≠ total', p1.count === 50 && p1.total > 50, `count=${p1.count} total=${p1.total}`);
  verifier('order annoncé', p1.order === 'name asc, id asc', p1.order);

  // --- Charge utile ---
  const poids = Buffer.byteLength(JSON.stringify(p1.results), 'utf8');
  verifier('50 fiches sous 15 Ko en profil court', poids < 15360, `${(poids / 1024).toFixed(1)} Ko`);

  // --- Lexique réel ---
  console.log('\n=== Lexique réel ===');
  for (const champ of ['reseau', 'niveau', 'logicielComptable']) {
    const lex = await listContactFieldValues(client, ListContactFieldValuesSchema.parse({ champ }));
    console.log(`  ${champ} (${lex.total} sociétés) :`);
    for (const v of lex.valeurs.slice(0, 6)) {
      console.log(`    ${String(v.count).padStart(5)}  ${v.valeur ?? '(non renseigné)'}`);
    }
  }

  // --- Agrégation ---
  console.log('\n=== Agrégation : écoles par réseau ===');
  const stats = await computeContactStats(client, ContactStatsSchema.parse({ groupBy: ['reseau'] }));
  verifier(
    'somme des groupes = total',
    stats.sumOfGroups === stats.total,
    `${stats.sumOfGroups} / ${stats.total}`,
  );
  for (const g of [...stats.groups].sort((a, b) => b.count - a.count)) {
    console.log(`    ${String(g.count).padStart(5)}  ${g.key[0]!.label ?? '(non renseigné)'}`);
  }

  console.log('\n=== Croisement réseau × niveau ===');
  const croise = await computeContactStats(client, ContactStatsSchema.parse({ groupBy: ['reseau', 'niveau'] }));
  console.log(`  ${croise.groupCount} combinaisons, total ${croise.total}`);
  for (const g of [...croise.groups].sort((a, b) => b.count - a.count).slice(0, 5)) {
    console.log(`    ${String(g.count).padStart(5)}  ${g.key.map((k) => k.label ?? '(vide)').join(' × ')}`);
  }

  // --- Jointure avec Assistance ---
  console.log('\n=== Jointure ticket → école ===');
  const tickets = await client.searchRead({
    model: 'helpdesk.ticket',
    method: 'search_read',
    domain: [['team_id', '=', 27]],
    fields: ['id'],
    limit: 6,
    order: 'id desc',
  });
  let resolus = 0;
  for (const t of tickets) {
    const r = await resolveSchoolFromTicket(client, t.id as number);
    if (r.ecole !== null) resolus += 1;
    console.log(
      `  ticket ${String(t.id).padEnd(6)} ${r.voie.padEnd(11)} ${r.ecole?.nom ?? '(non résolu)'}` +
        `${r.ecole?.fase ? ` — FASE ${r.ecole.fase}, ${r.ecole.reseau ?? '?'}` : ''}`,
    );
  }
  verifier('la majorité des tickets se résout en école', resolus >= tickets.length / 2, `${resolus}/${tickets.length}`);

  console.log(`\n${echecs === 0 ? 'Toutes les vérifications passent.' : `${echecs} vérification(s) en échec.`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('\nÉchec :', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

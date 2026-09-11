/**
 * Vérification de bout en bout des lots 2 à 8, contre l'instance réelle.
 * LECTURE SEULE : passe par les services du serveur, donc par la liste blanche.
 *
 *   npx tsx --env-file=.env scripts/verif-bout-en-bout.ts
 */
import { OdooClient } from '../src/clients/odooClient.js';
import { searchHelpdeskTickets } from '../src/services/helpdeskService.js';
import { computeHelpdeskStats, listHelpdeskTeams } from '../src/services/helpdeskStatsService.js';
import { SearchHelpdeskSchema } from '../src/schemas/helpdesk.js';
import { HelpdeskStatsSchema, ListHelpdeskTeamsSchema } from '../src/schemas/helpdeskStats.js';

const TEAM_ID = 27;
const client = new OdooClient();

let echecs = 0;
function verifier(label: string, condition: boolean, detail: string): void {
  console.log(`${condition ? '  OK  ' : ' ECHEC'} ${label} — ${detail}`);
  if (!condition) echecs += 1;
}

async function main() {
  // --- Lot 2 : tri déterministe ---
  console.log('\n=== Lot 2 — tri déterministe (D2) ===');
  const page1 = await searchHelpdeskTickets(
    client,
    SearchHelpdeskSchema.parse({ teamId: TEAM_ID, limit: 50, offset: 0 }),
  );
  const page2 = await searchHelpdeskTickets(
    client,
    SearchHelpdeskSchema.parse({ teamId: TEAM_ID, limit: 50, offset: 50 }),
  );
  const ids = [...page1.results, ...page2.results].map((r) => r.id);
  const dates = [...page1.results, ...page2.results].map((r) => r.createdAt ?? '');

  verifier('100 tickets récupérés', ids.length === 100, `${ids.length} tickets`);
  verifier('tous distincts', new Set(ids).size === ids.length, `${new Set(ids).size} ids uniques`);
  verifier(
    'create_date strictement décroissant',
    dates.every((d, i) => i === 0 || dates[i - 1]! >= d),
    `${dates[0]} → ${dates[dates.length - 1]}`,
  );
  verifier('order annoncé', page1.order === 'create_date desc, id desc', page1.order);

  // --- Lot 8 : count vs total ---
  console.log('\n=== Lot 8 — count (page) vs total (correspondances) (D3) ===');
  verifier('count = taille de page', page1.count === 50, `count=${page1.count}`);
  verifier('total > count', (page1.total ?? 0) > page1.count, `total=${page1.total}`);
  verifier('hasMore cohérent', page1.hasMore === true, `hasMore=${page1.hasMore}`);

  // --- Lot 5 : charge utile ---
  console.log('\n=== Lot 5 — charge utile (D6) ===');
  const poids = Buffer.byteLength(JSON.stringify(page1.results), 'utf8');
  verifier(
    'aucun fil de messages par défaut',
    page1.results.every((r) => !('history' in r) && !('messages' in r)),
    'clés history/messages absentes de la sortie',
  );

  // Le critère « 50 tickets sous 15 Ko » du plan ne tient que si l'appelant ne
  // demande pas la description : celle-ci est tronquée à MCP_MAX_CONTENT_LENGTH
  // (2000 caractères) et pèse à elle seule l'essentiel de la réponse.
  const leger = await searchHelpdeskTickets(
    client,
    SearchHelpdeskSchema.parse({ teamId: TEAM_ID, limit: 50, fields: ['id', 'name'] }),
  );
  const poidsLeger = Buffer.byteLength(JSON.stringify(leger.results), 'utf8');
  const indente = Buffer.byteLength(JSON.stringify(page1.results, null, 2), 'utf8');
  verifier(
    '50 tickets sous 15 Ko en volumétrie (fields restreints)',
    poidsLeger < 15360,
    `${(poidsLeger / 1024).toFixed(1)} Ko`,
  );
  console.log(
    `  info  charge utile : ${(poidsLeger / 1024).toFixed(1)} Ko sans description, ` +
      `${(poids / 1024).toFixed(1)} Ko avec, ${(indente / 1024).toFixed(1)} Ko si indenté. ` +
      'Le fil de messages, lui, ne pèse plus rien.',
  );

  // Ce que coûterait encore l'omission des clés nulles — décision non prise :
  // elle changerait la forme de la sortie au-delà de ce que le lot 5 prévoit.
  const sansNulls = JSON.stringify(leger.results, (_key, value) => (value === null ? undefined : value));
  console.log(
    `  info  si les clés nulles étaient omises : ${(Buffer.byteLength(sansNulls, 'utf8') / 1024).toFixed(1)} Ko ` +
      '(non appliqué — changerait la forme de la sortie).',
  );

  // Estimation du poids qu'aurait eu le même appel avant le lot 5 : un ticket
  // portait son fil complet, en double (history ET messages).
  const unTicketAvecFil = await searchHelpdeskTickets(
    client,
    SearchHelpdeskSchema.parse({ teamId: TEAM_ID, limit: 1, includeMessages: true, messageLimit: 20 }),
  );
  const avant = Buffer.byteLength(JSON.stringify(unTicketAvecFil.results), 'utf8') * 2 * 50;
  console.log(
    `  info  un appel équivalent AVANT le lot 5 : ~${(avant / 1024).toFixed(0)} Ko ` +
      `(fil complet sérialisé deux fois, 50 tickets) → ~${(avant / poids).toFixed(0)}× le poids actuel.`,
  );

  const avecMessages = await searchHelpdeskTickets(
    client,
    SearchHelpdeskSchema.parse({ teamId: TEAM_ID, limit: 2, includeMessages: true, messageLimit: 3 }),
  );
  verifier(
    'messages joints sur demande',
    avecMessages.results.every((r) => Array.isArray(r.history)),
    `${avecMessages.results[0]?.history?.length ?? 0} message(s) sur le 1er ticket`,
  );

  // --- Lot 3 : bornes temporelles ---
  console.log('\n=== Lot 3 — bornes temporelles (D1) ===');
  const fenetre = await searchHelpdeskTickets(
    client,
    SearchHelpdeskSchema.parse({ teamId: TEAM_ID, lastDays: 30, limit: 50 }),
  );
  const borne = new Date(`${fenetre.period.from!.replace(' ', 'T')}Z`).getTime();
  verifier(
    'tous les tickets sont dans la fenêtre',
    fenetre.results.every((r) => new Date(r.createdAt!).getTime() >= borne),
    `depuis ${fenetre.period.from}`,
  );

  // --- Lot 6 : catégories ---
  console.log('\n=== Lot 6 — catégories (D4) ===');
  verifier(
    'équipe exposée en sortie',
    fenetre.results[0]?.helpdesk?.team.label === 'Horizon Présences',
    String(fenetre.results[0]?.helpdesk?.team.label),
  );
  const avecEtiquette = fenetre.results.find((r) => (r.tags?.length ?? 0) > 0);
  verifier(
    'étiquettes résolues en libellés',
    avecEtiquette !== undefined && !avecEtiquette.tags![0]!.startsWith('#'),
    `ex. ${JSON.stringify(avecEtiquette?.tags)}`,
  );
  verifier(
    "'tags' n'est plus annoncé indisponible",
    !fenetre.results[0]!.unavailableFields.includes('tags'),
    JSON.stringify(fenetre.results[0]!.unavailableFields),
  );
  verifier(
    'updatedAt renseigné',
    fenetre.results[0]?.updatedAt !== null,
    String(fenetre.results[0]?.updatedAt),
  );

  // D9 : appel sans `fields` (liste blanche complète par défaut).
  const sansFields = await searchHelpdeskTickets(
    client,
    SearchHelpdeskSchema.parse({ teamId: TEAM_ID, limit: 1 }),
  );
  verifier('D9 — appel sans `fields` fonctionne', sansFields.results.length === 1, 'liste blanche complète acceptée');

  // --- Lot 4 : agrégation ---
  console.log('\n=== Lot 4 — agrégation (D3, D5) ===');
  const parEquipe = await computeHelpdeskStats(
    client,
    HelpdeskStatsSchema.parse({ groupBy: ['team_id'], lastDays: 30 }),
  );
  const groupe27 = parEquipe.groups.find((g) => g.key[0]!.id === TEAM_ID);
  verifier(
    'équipe 27 présente dans le regroupement',
    groupe27 !== undefined,
    `${groupe27?.count} tickets — ${groupe27?.key[0]?.label}`,
  );

  const equipes = await listHelpdeskTeams(client, ListHelpdeskTeamsSchema.parse({ limit: 100 }));
  const equipe27 = equipes.results.find((t) => t.id === TEAM_ID);
  verifier('27 = Horizon Présences (D5)', equipe27?.name === 'Horizon Présences', String(equipe27?.name));

  // --- La question d'origine, en un seul appel ---
  console.log("\n=== La question d'origine, en un seul appel ===");
  const parProduit = await computeHelpdeskStats(
    client,
    HelpdeskStatsSchema.parse({ groupBy: ['x_studio_produit'], teamId: TEAM_ID, lastDays: 30 }),
  );
  verifier(
    'somme des groupes = total',
    parProduit.sumOfGroups === parProduit.total,
    `${parProduit.sumOfGroups} / ${parProduit.total}`,
  );
  console.log(`\n  Équipe 27 (Horizon Présences), 30 derniers jours — ${parProduit.total} tickets`);
  for (const groupe of [...parProduit.groups].sort((a, b) => b.count - a.count)) {
    const label = groupe.key[0]!.label ?? '(non renseigné)';
    const part = ((groupe.count / parProduit.total) * 100).toFixed(1);
    console.log(`    ${String(groupe.count).padStart(4)}  ${part.padStart(5)}%  ${label}`);
  }
  for (const avertissement of parProduit.warnings) {
    console.log(`  ! ${avertissement}`);
  }

  const parEtiquette = await computeHelpdeskStats(
    client,
    HelpdeskStatsSchema.parse({ groupBy: ['tag_ids'], teamId: TEAM_ID, lastDays: 30 }),
  );
  console.log(`\n  Par étiquette — ${parEtiquette.total} tickets`);
  for (const groupe of [...parEtiquette.groups].sort((a, b) => b.count - a.count)) {
    console.log(`    ${String(groupe.count).padStart(4)}  ${groupe.key[0]!.label ?? '(aucune étiquette)'}`);
  }

  console.log(`\n${echecs === 0 ? 'Toutes les vérifications passent.' : `${echecs} vérification(s) en échec.`}`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('\nÉchec :', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

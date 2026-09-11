/**
 * Script de diagnostic JETABLE — lot 1 du plan d'amélioration (défaut D8).
 *
 * Objet : expliquer pourquoi aucun ticket postérieur au 04/09/2026 ne remontait
 * alors que l'extraction datait du 08/09, et mesurer sur l'instance réelle les
 * comportements dont dépendent les lots 4 (read_group) et 6 (ticket_type_id).
 *
 * LECTURE SEULE. N'émet que `search_count`, `search_read`, `read_group` et
 * `fields_get`. Aucune méthode d'écriture, sous aucune forme.
 *
 * Ce script vit HORS de `src/` et parle à Odoo en direct, délibérément : il a
 * besoin de `fields_get` (introspection ponctuelle, à la conception) sans que la
 * liste blanche du serveur MCP ne gagne jamais cette méthode.
 *
 *   npx tsx --env-file=.env scripts/diagnostic-d8.ts
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

const TEAM_ID = 27;
const ODOO_BASE_URL = process.env.ODOO_BASE_URL?.replace(/\/+$/, '');
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = Number(process.env.ODOO_UID);
const ODOO_API_KEY = process.env.ODOO_API_KEY;

const OUT_FILE =
  process.env.DIAGNOSTIC_OUT ??
  resolveOut('diagnostic-d8.json');

if (!ODOO_BASE_URL || !ODOO_DB || !ODOO_UID || !ODOO_API_KEY) {
  console.error('Variables Odoo manquantes. Lancez avec `npx tsx --env-file=.env scripts/diagnostic-d8.ts`.');
  process.exit(1);
}

/** Méthodes autorisées dans ce script de diagnostic. Aucune écriture, jamais. */
const READ_ONLY_METHODS = new Set(['search_count', 'search_read', 'read_group', 'fields_get']);

async function odooCall(
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<unknown> {
  if (!READ_ONLY_METHODS.has(method)) {
    throw new Error(`Méthode non autorisée dans ce diagnostic : ${method}`);
  }
  const body = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
    },
    id: Date.now(),
  };
  const response = await axios.post(`${ODOO_BASE_URL}/jsonrpc`, body, {
    timeout: 60000,
    headers: { 'Content-Type': 'application/json' },
  });
  if (response.data?.error) {
    const details = response.data.error?.data ?? response.data.error;
    throw new Error(`Odoo error [${details?.name ?? '?'}] ${details?.message ?? response.data.error.message}`);
  }
  return response.data?.result;
}

/** Datetime Odoo naïf UTC, `YYYY-MM-DD HH:MM:SS`. */
function toOdooDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function daysAgo(n: number, now = new Date()): string {
  return toOdooDatetime(new Date(now.getTime() - n * 86_400_000));
}

const report: Record<string, unknown> = {};

async function step<T>(key: string, label: string, fn: () => Promise<T>): Promise<T | null> {
  process.stdout.write(`\n### ${label}\n`);
  try {
    const value = await fn();
    report[key] = value;
    console.dir(value, { depth: 6 });
    return value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report[key] = { erreur: message };
    console.error(`  ÉCHEC : ${message}`);
    return null;
  }
}

async function main() {
  const now = new Date();
  report.meta = {
    executeLe: now.toISOString(),
    instance: ODOO_BASE_URL,
    baseDeDonnees: ODOO_DB,
    uid: ODOO_UID,
    teamId: TEAM_ID,
  };
  console.log(`Diagnostic D8 — instance ${ODOO_BASE_URL} (db ${ODOO_DB}), uid ${ODOO_UID}, ${now.toISOString()}`);

  // Version d'Odoo : conditionne le comportement de read_group sur tag_ids (lot 4, §13 risques).
  await step('versionOdoo', "0. Version d'Odoo", async () => {
    const res = await axios.post(
      `${ODOO_BASE_URL}/jsonrpc`,
      { jsonrpc: '2.0', method: 'call', params: { service: 'common', method: 'version', args: [] }, id: 1 },
      { timeout: 30000, headers: { 'Content-Type': 'application/json' } },
    );
    return res.data?.result;
  });

  // 1. Volumétrie brute.
  await step('totaux', '1. search_count : instance entière, puis équipe 27', async () => ({
    totalInstance: await odooCall('helpdesk.ticket', 'search_count', [[]]),
    totalEquipe27: await odooCall('helpdesk.ticket', 'search_count', [[['team_id', '=', TEAM_ID]]]),
  }));

  // 2. LA mesure décisive : jusqu'où va la donnée de l'instance connectée ?
  await step('horizonParDate', '2. Tickets les plus récents par create_date (équipe 27)', () =>
    odooCall(
      'helpdesk.ticket',
      'search_read',
      [[['team_id', '=', TEAM_ID]]],
      { fields: ['id', 'name', 'create_date', 'write_date'], limit: 5, order: 'create_date desc' },
    ),
  );

  // 3. Même chose par id : si l'id max et la date max ne désignent pas le même
  //    ticket, la cause est un tri, pas une latence.
  await step('horizonParId', '3. Tickets d’id le plus élevé (équipe 27)', () =>
    odooCall(
      'helpdesk.ticket',
      'search_read',
      [[['team_id', '=', TEAM_ID]]],
      { fields: ['id', 'name', 'create_date'], limit: 5, order: 'id desc' },
    ),
  );

  // 3 bis. Horizon toutes équipes confondues : distingue « l'équipe 27 est calme »
  //        de « l'instance entière s'arrête à cette date ».
  await step('horizonToutesEquipes', '3 bis. Ticket le plus récent, toutes équipes', () =>
    odooCall('helpdesk.ticket', 'search_read', [[]], {
      fields: ['id', 'name', 'create_date', 'team_id'],
      limit: 3,
      order: 'create_date desc',
    }),
  );

  // 4. Fenêtre courte, à comparer au résultat de l'outil MCP.
  await step('septDerniersJours', '4. search_count équipe 27 sur 7 jours', async () => {
    const from = daysAgo(7, now);
    return {
      depuis: from,
      count: await odooCall('helpdesk.ticket', 'search_count', [
        [['team_id', '=', TEAM_ID], ['create_date', '>=', from]],
      ]),
    };
  });

  // 5. Filtre `active` : un ticket archivé est invisible par défaut.
  await step('filtreActive', '5. Effet de active_test=false (tickets archivés)', async () => {
    const domain = [['team_id', '=', TEAM_ID]];
    return {
      parDefaut: await odooCall('helpdesk.ticket', 'search_count', [domain]),
      avecArchives: await odooCall('helpdesk.ticket', 'search_count', [domain], {
        context: { active_test: false },
      }),
    };
  });

  // 5 bis. Règles d'enregistrement : ce que voit le compte technique vs le total
  //        réel se lit dans l'écart entre un domaine vide et un domaine large.
  await step('trenteJours', '5 bis. Équipe 27 sur 30 jours', async () => {
    const from = daysAgo(30, now);
    return {
      depuis: from,
      count: await odooCall('helpdesk.ticket', 'search_count', [
        [['team_id', '=', TEAM_ID], ['create_date', '>=', from]],
      ]),
    };
  });

  // 6. read_group : valide le comportement réel avant d'écrire le lot 4, et
  //    répond à la question du lot 6 (quel champ Scolares utilise vraiment).
  const from30 = daysAgo(30, now);
  const domain30 = [['team_id', '=', TEAM_ID], ['create_date', '>=', from30]];

  await step('groupeParType', '6a. read_group par ticket_type_id (30 j)', () =>
    odooCall('helpdesk.ticket', 'read_group', [domain30, ['id'], ['ticket_type_id']], {
      lazy: false,
      context: { tz: 'Europe/Brussels' },
    }),
  );

  await step('groupeParEtiquette', '6b. read_group par tag_ids (30 j) — champ multivalué', () =>
    odooCall('helpdesk.ticket', 'read_group', [domain30, ['id'], ['tag_ids']], {
      lazy: false,
      context: { tz: 'Europe/Brussels' },
    }),
  );

  await step('groupeParJour', '6c. read_group par create_date:day (30 j) — vérifie le fuseau', () =>
    odooCall('helpdesk.ticket', 'read_group', [domain30, ['id'], ['create_date:day']], {
      lazy: false,
      context: { tz: 'Europe/Brussels' },
    }),
  );

  await step('groupeCroise', '6d. read_group croisé stage_id × ticket_type_id (lazy:false)', () =>
    odooCall('helpdesk.ticket', 'read_group', [domain30, ['id'], ['stage_id', 'ticket_type_id']], {
      lazy: false,
      context: { tz: 'Europe/Brussels' },
    }),
  );

  await step('groupeParEquipe', '6e. read_group par team_id (30 j, toutes équipes)', () =>
    odooCall('helpdesk.ticket', 'read_group', [[['create_date', '>=', from30]], ['id'], ['team_id']], {
      lazy: false,
      context: { tz: 'Europe/Brussels' },
    }),
  );

  // 6 f. Combien de tickets sans type ? Chiffre attendu par le critère du lot 6.
  await step('sansType', '6f. Tickets sans ticket_type_id (30 j, équipe 27)', () =>
    odooCall('helpdesk.ticket', 'search_count', [[...domain30, ['ticket_type_id', '=', false]]]),
  );

  // 7. D5 : relier l'identifiant 27 à un nom d'équipe.
  await step('equipes', '7. helpdesk.team', () =>
    odooCall('helpdesk.team', 'search_read', [[]], {
      fields: ['id', 'name', 'company_id', 'active'],
      limit: 100,
      order: 'id asc',
    }),
  );

  await step('typesDeTicket', '7 bis. helpdesk.ticket.type', () =>
    odooCall('helpdesk.ticket.type', 'search_read', [[]], {
      fields: ['id', 'name', 'sequence'],
      limit: 100,
      order: 'sequence asc, id asc',
    }),
  );

  await step('etiquettes', '7 ter. helpdesk.tag', () =>
    odooCall('helpdesk.tag', 'search_read', [[]], {
      fields: ['id', 'name', 'color'],
      limit: 200,
      order: 'id asc',
    }),
  );

  // 8. Introspection ponctuelle : alimente la table statique du lot 8
  //    (distinguer « champ inconnu d'Odoo » de « champ non exposé »).
  await step('champsHelpdeskTicket', '8. fields_get helpdesk.ticket (noms + types)', async () => {
    const fields = (await odooCall('helpdesk.ticket', 'fields_get', [[], ['type', 'string']])) as Record<
      string,
      { type?: string; string?: string }
    >;
    const noms = Object.keys(fields).sort();
    console.log(`  ${noms.length} champs sur helpdesk.ticket`);
    return {
      nombre: noms.length,
      noms,
      interessants: Object.fromEntries(
        noms
          .filter((n) => /type|categ|tag|team|stage|priorit|date/i.test(n))
          .map((n) => [n, `${fields[n]?.type ?? '?'} — ${fields[n]?.string ?? ''}`]),
      ),
    };
  });

  // 9. Reproduction du comportement actuel de l'outil MCP : aucun `order`
  //    transmis → on lit le `_order` par défaut du modèle (défaut D2).
  await step('ordreParDefaut', '9. search_read SANS order (reproduit D2)', () =>
    odooCall('helpdesk.ticket', 'search_read', [[['team_id', '=', TEAM_ID]]], {
      fields: ['id', 'create_date', 'priority'],
      limit: 8,
    }),
  );

  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n\nRapport complet écrit dans ${OUT_FILE}`);
}

main().catch((error: unknown) => {
  console.error('\nÉchec du diagnostic :');
  console.error(error instanceof Error ? error.message : String(error));
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  process.exit(1);
});

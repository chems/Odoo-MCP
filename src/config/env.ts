import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Racine du projet, indépendante de `process.cwd()` : ce fichier vit toujours
 * sous `<racine>/src/config/env.ts` (ou `<racine>/dist/config/env.js` compilé),
 * donc `../..` depuis son propre dossier pointe toujours sur la racine — même
 * quand le process est lancé par un client MCP (ex. Claude Desktop) qui ne fixe
 * pas de `cwd` explicite et pourrait sinon résoudre `.cache/embeddings` ailleurs.
 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const EnvSchema = z.object({
  ODOO_BASE_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  ODOO_DB: z.string().min(1),
  ODOO_UID: z.coerce.number().int().positive(),
  ODOO_API_KEY: z.string().min(1),

  ODOO_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ODOO_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  ODOO_HTTP_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(300),

  MCP_MAX_RESULTS_PER_QUERY: z.coerce.number().int().positive().max(200).default(50),
  MCP_MAX_CONTENT_LENGTH: z.coerce.number().int().positive().default(2000),

  CROSS_SEARCH_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.15),

  // --- Recherche sémantique (embeddings locaux, voir `npm run reindex`) ---
  EMBEDDING_MODEL_ID: z.string().min(1).default('Xenova/all-MiniLM-L6-v2'),
  EMBEDDING_CACHE_DIR: z.string().min(1).default('.cache/embeddings'),
  EMBEDDING_MAX_TEXT_LENGTH: z.coerce.number().int().positive().default(1000),
  EMBEDDING_CACHE_STALE_AFTER_MS: z.coerce.number().int().positive().default(21_600_000),
  SEMANTIC_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
  SEMANTIC_TOP_K: z.coerce.number().int().positive().default(20),
  HYBRID_LEXICAL_WEIGHT: z.coerce.number().min(0).max(1).default(0.5),
  HYBRID_SEMANTIC_WEIGHT: z.coerce.number().min(0).max(1).default(0.5),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Les quatre variables sans lesquelles le serveur ne peut rien faire. */
const REQUIRED_VARS = ['ODOO_BASE_URL', 'ODOO_DB', 'ODOO_UID', 'ODOO_API_KEY'] as const;

/**
 * Message destiné à quelqu'un qui vient de lancer `node dist/index.js` à la
 * main : dire ce qui manque ne suffit pas, il faut dire d'où ça devrait venir.
 */
function formatConfigError(issues: readonly { path: (string | number)[]; message: string }[]): string {
  const lignes = issues.map((issue) => {
    // zod dit « Expected number, received nan » quand la variable est
    // simplement absente puis coercée : illisible pour qui découvre l'erreur.
    const message =
      issue.message === 'Required' || issue.message.includes('received nan')
        ? 'manquante'
        : issue.message;
    return `  - ${issue.path.join('.')} : ${message}`;
  });

  const toutesAbsentes = REQUIRED_VARS.every((v) => process.env[v] === undefined);
  const aide = toutesAbsentes
    ? [
        '',
        "Aucune variable Odoo n'est définie. Le serveur ne contient aucun secret en dur :",
        "il les lit exclusivement dans l'environnement.",
        '',
        'Pour le lancer à la main, depuis la racine du projet :',
        '  npm start      — serveur compilé, lit le fichier .env',
        '  npm run dev    — sources TypeScript, lit le fichier .env',
        '',
        'Sans fichier .env : copiez .env.example puis remplissez-le.',
        '',
        'Lancé par un client MCP (Claude Desktop), les variables viennent du bloc',
        '`env` de sa configuration, jamais du fichier .env.',
      ]
    : ['', 'Complétez ces variables dans .env, ou dans le bloc `env` de votre client MCP.'];

  return [
    "Configuration invalide (variables d'environnement manquantes ou incorrectes) :",
    ...lignes,
    ...aide,
  ].join('\n');
}

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(formatConfigError(parsed.error.issues));
    process.exit(1);
  }
  return {
    ...parsed.data,
    EMBEDDING_CACHE_DIR: path.isAbsolute(parsed.data.EMBEDDING_CACHE_DIR)
      ? parsed.data.EMBEDDING_CACHE_DIR
      : path.join(PROJECT_ROOT, parsed.data.EMBEDDING_CACHE_DIR),
  };
}

export const env: Env = loadEnv();

/**
 * Masque une valeur sensible pour les logs : conserve les 2 premiers caractères,
 * masque le reste. Ne jamais logger ODOO_API_KEY / ODOO_UID en clair.
 */
export function maskSecret(value: string | number): string {
  const str = String(value);
  if (str.length <= 2) {
    return '*'.repeat(str.length);
  }
  return `${str.slice(0, 2)}${'*'.repeat(Math.max(str.length - 2, 4))}`;
}

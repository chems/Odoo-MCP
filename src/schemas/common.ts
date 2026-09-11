import { z } from 'zod';

/**
 * Schéma de base partagé par les 3 tools MCP. `limit`/`offset` sont plafonnés
 * indépendamment du plafond dur serveur (MCP_MAX_RESULTS_PER_QUERY) appliqué
 * ensuite dans les services.
 */
/**
 * `text` : recherche lexicale multi-mots (AND de termes) sur les champs indexés.
 * `semantic` : recherche par similarité d'embeddings sur le cache vectoriel local
 * (voir `npm run reindex`) ; retombe sur `text` si le cache est absent.
 * `hybrid` : fusion pondérée des deux (`HYBRID_LEXICAL_WEIGHT`/`HYBRID_SEMANTIC_WEIGHT`).
 */
export const SearchModeSchema = z.enum(['text', 'semantic', 'hybrid']).default('text');

export const BaseQuerySchema = z.object({
  query: z.string().trim().min(1, 'query ne peut pas être vide').max(200),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
  fields: z.array(z.string()).optional(),
  mode: SearchModeSchema,
});

export type BaseQueryParams = z.infer<typeof BaseQuerySchema>;

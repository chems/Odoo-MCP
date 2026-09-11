import { z } from 'zod';
import { SearchModeSchema } from './common.js';

export const SearchAllSchema = z.object({
  query: z.string().trim().min(1, 'query ne peut pas être vide').max(200),
  limit: z.number().int().min(1).max(50).default(10),
  includeRelations: z.boolean().default(true),
  mode: SearchModeSchema,
});

export type SearchAllParams = z.infer<typeof SearchAllSchema>;

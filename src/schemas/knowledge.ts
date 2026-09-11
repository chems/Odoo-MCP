import { z } from 'zod';
import { BaseQuerySchema } from './common.js';

export const SearchKnowledgeSchema = BaseQuerySchema.extend({
  parentId: z.number().int().positive().optional(),
  isPublished: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});

export type SearchKnowledgeParams = z.infer<typeof SearchKnowledgeSchema>;

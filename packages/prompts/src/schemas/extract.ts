import { z } from "zod";

export const ExtractSchema = z.object({
  header: z.object({
    title: z.string().optional(),
    date: z.string().optional(),
    location: z.string().optional()
  }).default({}),
  context: z.object({
    summary: z.string().optional()
  }).default({}),
  technical_analysis: z.object({
    summary: z.string().optional()
  }).default({}),
  quote_lines_intent: z.array(z.object({
    label: z.string(),
    qty: z.number().optional(),
    uom: z.string().optional(),
    type: z.enum(["service","product"]).optional(),
    notes: z.string().optional()
  })).default([]),
  final_summary: z.string().optional()
});

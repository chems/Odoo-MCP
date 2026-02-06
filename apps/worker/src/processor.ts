import { runPipeline } from "./pipeline/run_pipeline.js";
import { z } from "zod";

const JobSchema = z.object({
  transcription: z.string(),
  odoo: z.record(z.any()).default({}),
  customerHint: z.record(z.any()).default({})
});

export async function processJob(jobId: string, data: unknown) {
  const job = JobSchema.parse(data);
  // Orchestration (prompts) + MCP Odoo actions
  const result = await runPipeline({
    jobId,
    transcription: job.transcription,
    odoo: job.odoo,
    customerHint: job.customerHint
  });
  return result;
}

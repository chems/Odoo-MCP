import Fastify from "fastify";
import { z } from "zod";
import { enqueueJob } from "@packages/queue/job_enqueuer";
import { verifyIngestSignature } from "./middleware/auth_ingest.js";

const app = Fastify({ logger: true });

const IngestSchema = z.object({
  transcription: z.string().min(20),
  // Optional metadata from Odoo
  odoo: z.object({
    db: z.string().optional(),
    uid: z.number().int().positive().optional(),
    // token / api_key NOT recommended to be pushed; prefer server-side config.
    opportunityId: z.number().int().positive().optional(),
    leadId: z.number().int().positive().optional(),
    saleOrderId: z.number().int().positive().optional()
  }).optional(),
  customerHint: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional()
  }).optional()
});

app.get("/health", async () => ({ ok: true }));

app.post("/ingest", async (req, reply) => {
  // Auth: shared secret signature (HMAC) from Odoo automation
  verifyIngestSignature(req);

  const parsed = IngestSchema.parse(req.body);
  const job = await enqueueJob({
    transcription: parsed.transcription,
    odoo: parsed.odoo ?? {},
    customerHint: parsed.customerHint ?? {}
  });

  return reply.code(202).send({ jobId: job.id });
});

// Minimal job status endpoint (POC)
app.get("/jobs/:id", async (req) => {
  const { id } = req.params as { id: string };
  // For POC: job status can be stored in Redis or Postgres later
  return { jobId: id, status: "unknown (POC)" };
});

app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

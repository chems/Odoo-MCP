import { Worker } from "bullmq";
import { connection } from "@packages/queue/connection";
import { processJob } from "./processor.js";

const queueName = "transcription_jobs";

const worker = new Worker(queueName, async (job) => {
  return await processJob(job.id, job.data);
}, { connection });

worker.on("completed", (job) => {
  console.log("[worker] completed", job.id);
});

worker.on("failed", (job, err) => {
  console.error("[worker] failed", job?.id, err);
});

console.log("[worker] started");

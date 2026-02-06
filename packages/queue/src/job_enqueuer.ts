import { getQueue } from "./queue.js";

const queueName = "transcription_jobs";

export async function enqueueJob(payload: any) {
  const q = getQueue(queueName);
  const job = await q.add("analyze_transcription", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 }
  });
  return job;
}

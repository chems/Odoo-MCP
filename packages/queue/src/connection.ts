import { RedisOptions } from "bullmq";

export const connection: RedisOptions = {
  // BullMQ accepts a redis URL via ioredis under the hood (POC).
  // In production you may use ioredis directly. For POC we just pass connection options.
  host: undefined as unknown as string
};

// Minimal connection: if REDIS_URL is provided, BullMQ can use it via `connection: { url }`
export function getRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("Missing REDIS_URL");
  return { url };
}

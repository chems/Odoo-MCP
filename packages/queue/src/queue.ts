import { Queue } from "bullmq";
import { getRedisConnection } from "./connection.js";

export function getQueue(name: string) {
  return new Queue(name, { connection: getRedisConnection() as any });
}

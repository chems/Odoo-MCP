import type { FastifyRequest } from "fastify";
import crypto from "node:crypto";

// Simple HMAC signature verification (POC):
// Odoo sends headers:
//  - x-ingest-timestamp: unix seconds
//  - x-ingest-signature: hex(hmac_sha256(secret, timestamp + "." + rawBody))
export function verifyIngestSignature(req: FastifyRequest) {
  const secret = process.env.INGEST_SHARED_SECRET;
  if (!secret) throw new Error("Missing INGEST_SHARED_SECRET");

  const ts = req.headers["x-ingest-timestamp"];
  const sig = req.headers["x-ingest-signature"];
  if (!ts || !sig) throw new Error("Missing ingest signature headers");

  const timestamp = Number(ts);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) {
    throw new Error("Invalid/expired ingest timestamp");
  }

  // Fastify can provide raw body via content type parser; for POC we hash JSON string.
  const raw = JSON.stringify(req.body ?? {});
  const msg = `${timestamp}.${raw}`;
  const expected = crypto.createHmac("sha256", secret).update(msg).digest("hex");

  if (!timingSafeEqualHex(String(sig), expected)) {
    throw new Error("Invalid ingest signature");
  }
}

function timingSafeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

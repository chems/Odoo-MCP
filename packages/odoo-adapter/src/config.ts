import { z } from "zod";
import type { OdooCredentials } from "./types.js";

const EnvSchema = z.object({
  ODOO_URL: z.string().url(),
  ODOO_DB: z.string().min(1),
  ODOO_LOGIN: z.string().min(1).optional(),
  ODOO_API_KEY: z.string().min(1),
  ODOO_UID: z.string().optional()
});

export function readOdooCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): OdooCredentials {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid Odoo env vars: ${msg}`);
  }
  const { ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, ODOO_UID } = parsed.data;
  
  // Si ODOO_UID est fourni, ODOO_LOGIN n'est pas nécessaire car on n'appellera pas login()
  if (!ODOO_UID && !ODOO_LOGIN) {
    throw new Error("Either ODOO_UID or ODOO_LOGIN must be provided");
  }
  
  return {
    url: ODOO_URL.replace(/\/+$/,""),
    db: ODOO_DB,
    login: ODOO_LOGIN,
    apiKey: ODOO_API_KEY,
    uid: ODOO_UID ? Number(ODOO_UID) : undefined
  };
}

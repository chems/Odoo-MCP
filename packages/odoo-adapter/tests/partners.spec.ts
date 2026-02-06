import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Charger le .env depuis la racine du projet AVANT tous les imports
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env");
const result = config({ path: envPath });
if (result.error) {
  console.warn(`[test] Failed to load .env from ${envPath}:`, result.error);
} else {
  console.log(`[test] Loaded .env from ${envPath}`);
}

import { describe, it, expect } from "vitest";
import { createOdooClientFromEnv } from "../src/client.js";
import { partnerTests } from "../testdata/partners.js";

describe("odoo-adapter: partners.searchRead", () => {
  const odoo = createOdooClientFromEnv();

  for (const t of partnerTests) {
    it(`searchRead ${t.name}`, async () => {
      const res = await odoo.partners.searchRead(t.domain, {
        fields: t.fields,
        limit: t.limit ?? 5
      });

      console.log(`[partners.searchRead] ${t.name}`, res);
      expect(Array.isArray(res)).toBe(true);
    });
  }
});


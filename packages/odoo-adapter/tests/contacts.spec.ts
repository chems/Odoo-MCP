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
import { contactTests } from "../testdata/contacts.js";

describe("odoo-adapter: contacts (partners avec is_company = false)", () => {
  const odoo = createOdooClientFromEnv();

  for (const t of contactTests) {
    it(`searchRead ${t.name}`, async () => {
      const res = await odoo.partners.searchRead(t.domain, {
        fields: t.fields,
        limit: t.limit ?? 5
      });

      console.log(`[contacts.searchRead] ${t.name}`, res);
      expect(Array.isArray(res)).toBe(true);
      
      // Vérification spécifique pour les contacts
      if (t.name.includes("is_company = false")) {
        res.forEach((contact: any) => {
          expect(contact.is_company).toBe(false);
        });
      }
    });
  }
});

import "./_setup_env.js";

import { describe, it, expect } from "vitest";
import { createOdooClientFromEnv } from "../src/client.js";
import { readFixtureJson, type SearchReadFixture } from "./_fixtures.js";
import type { Rule } from "../src/rules.js";

describe("odoo-adapter: contacts (partners avec is_company = false)", () => {
  const odoo = createOdooClientFromEnv();
  const fixture = readFixtureJson<SearchReadFixture>("contacts.json");

  for (const t of fixture.cases) {
    it(`searchRead ${t.name}`, async () => {
      const res = await odoo.partners.searchReadRule(t.rule as Rule, {
        fields: t.fields,
        limit: t.limit ?? 5
      });

      console.log(`[contacts.searchRead] ${t.name}`, res);
      expect(Array.isArray(res)).toBe(true);

      // Vérification spécifique: tous les résultats doivent être des contacts
      res.forEach((contact: any) => {
        if ("is_company" in contact) expect(contact.is_company).toBe(false);
      });
    });
  }
});

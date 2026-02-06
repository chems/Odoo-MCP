import "./_setup_env.js";

import { describe, it, expect } from "vitest";
import { createOdooClientFromEnv } from "../src/client.js";
import { readFixtureJson, type SearchReadFixture } from "./_fixtures.js";
import type { Rule } from "../src/rules.js";

describe("odoo-adapter: partners.searchRead", () => {
  const odoo = createOdooClientFromEnv();
  const fixture = readFixtureJson<SearchReadFixture>("partners.json");

  for (const t of fixture.cases) {
    it(`searchRead ${t.name}`, async () => {
      const res = await odoo.partners.searchReadRule(t.rule as Rule, {
        fields: t.fields,
        limit: t.limit ?? 5
      });

      console.log(`[partners.searchRead] ${t.name}`, res);
      expect(Array.isArray(res)).toBe(true);
    });
  }
});


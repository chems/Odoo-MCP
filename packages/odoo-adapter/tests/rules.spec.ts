import "./_setup_env.js";

import { describe, it, expect } from "vitest";
import { toOdooDomain } from "../src/rules.js";
import { createOdooClientFromEnv } from "../src/client.js";
import type { Rule } from "../src/rules.js";
import { readFixtureJson, type RulesFixture } from "./_fixtures.js";

describe("odoo-adapter: rules system", () => {
  describe("toOdooDomain conversion", () => {
    const fixture = readFixtureJson<RulesFixture>("rules.json");
    for (const t of fixture.cases) {
      it(`should convert rule: ${t.name}`, () => {
        const domain = toOdooDomain(t.rule as Rule);
        console.log(`[rules] ${t.name}:`, JSON.stringify(domain, null, 2));
        expect(Array.isArray(domain)).toBe(true);
        expect(domain).toEqual(t.expectedDomain);
      });
    }
  });

  describe("rules with real Odoo queries", () => {
    const odoo = createOdooClientFromEnv();

    it("should work with OR rule", async () => {
      const rule: Rule = {
        or: [
          ["id", "=", 1],
          ["id", "=", 2]
        ]
      };
      const domain = toOdooDomain(rule);
      
      const res = await odoo.partners.searchRead(domain, {
        fields: ["id", "name"],
        limit: 5
      });

      console.log("[rules] OR rule result:", res);
      expect(Array.isArray(res)).toBe(true);
    });

    it("should work with AND rule", async () => {
      const rule: Rule = {
        and: [
          ["is_company", "=", false],
          ["email", "!=", false]
        ]
      };
      const domain = toOdooDomain(rule);
      
      const res = await odoo.partners.searchRead(domain, {
        fields: ["id", "name", "email"],
        limit: 5
      });

      console.log("[rules] AND rule result:", res);
      expect(Array.isArray(res)).toBe(true);
    });

    it("should work with OR + AND combined rule", async () => {
      const rule: Rule = {
        and: [
          {
            or: [
              ["id", "=", 1],
              ["id", "=", 2]
            ]
          },
          ["is_company", "=", true]
        ]
      };
      const domain = toOdooDomain(rule);
      
      const res = await odoo.partners.searchRead(domain, {
        fields: ["id", "name", "is_company"],
        limit: 5
      });

      console.log("[rules] OR + AND combined rule result:", res);
      expect(Array.isArray(res)).toBe(true);
    });
  });
});

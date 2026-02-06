import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/odoo-adapter/tests
const testsDir = __dirname;
// packages/odoo-adapter
const packageRoot = resolve(testsDir, "..");

export function readFixtureJson<T>(fixtureFileName: string): T {
  const fixturePath = resolve(packageRoot, "fixtures", fixtureFileName);
  const raw = readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw) as T;
}

export type SearchReadFixture = {
  schema: "odoo-adapter.search_read.cases.v1";
  model: string;
  cases: Array<{
    name: string;
    rule: unknown;
    fields?: string[] | ["__all__"];
    limit?: number;
  }>;
};

export type RulesFixture = {
  schema: "odoo-adapter.rules.cases.v1";
  cases: Array<{
    name: string;
    rule: unknown;
    expectedDomain: unknown;
  }>;
};


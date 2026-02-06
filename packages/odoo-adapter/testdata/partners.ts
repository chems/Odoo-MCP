import type { Domain } from "../src/types.js";
import { domainOR, domainAND } from "../src/client.js";

export type PartnerTestCase = {
  name: string;
  domain: Domain;
  fields: string[] | ["__all__"];
  limit?: number;
};

export const partnerTests: PartnerTestCase[] = [
  {
    name: "par id = 1",
    domain: [["id", "=", 1]],
    fields: ["id", "name", "is_company", "supplier_rank", "customer_rank", "company_id"],
    limit: 1
  },
  {
    name: 'par display_name ~ "BM Bat SRL"',
    domain: [["display_name", "ilike", "BM Bat SRL"]],
    fields: ["id", "name", "display_name", "is_company"],
    limit: 5
  },
  {
    name: "par id = 1 OU id = 2 (OR)",
    domain: domainOR(
      ["id", "=", 1] as Domain,
      ["id", "=", 2] as Domain
    ),
    fields: ["id", "name", "is_company"],
    limit: 5
  },
  {
    name: "par is_company = true ET supplier_rank > 0 (AND)",
    domain: domainAND(
      ["is_company", "=", true] as Domain,
      ["supplier_rank", ">", 0] as Domain
    ),
    fields: ["id", "name", "is_company", "supplier_rank"],
    limit: 10
  },
  {
    name: "par (id = 1 OU id = 2) ET is_company = true (OR + AND combinés)",
    domain: domainAND(
      domainOR(
        ["id", "=", 1] as Domain,
        ["id", "=", 2] as Domain
      ),
      ["is_company", "=", true] as Domain
    ),
    fields: ["id", "name", "is_company"],
    limit: 5
  }
];


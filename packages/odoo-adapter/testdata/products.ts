import type { Domain } from "../src/types.js";
import { domainOR, domainAND } from "../src/client.js";

export type ProductTestCase = {
  name: string;
  domain: Domain;
  fields: string[] | ["__all__"];
  limit?: number;
};

export const productTests: ProductTestCase[] = [
  {
    name: "par id = 1",
    domain: [["id", "=", 1]],
    fields: ["id", "name", "type", "list_price"],
    limit: 1
  },
  {
    name: 'par name ~ "plomberie"',
    domain: [["name", "ilike", "plomberie"]],
    fields: ["id", "name", "type"],
    limit: 5
  },
  {
    name: "par type = service OU type = product (OR)",
    domain: domainOR(
      ["type", "=", "service"] as Domain,
      ["type", "=", "product"] as Domain
    ),
    fields: ["id", "name", "type"],
    limit: 10
  },
  {
    name: "par type = service ET list_price > 0 (AND)",
    domain: domainAND(
      ["type", "=", "service"] as Domain,
      ["list_price", ">", 0] as Domain
    ),
    fields: ["id", "name", "type", "list_price"],
    limit: 10
  },
  {
    name: "par (name ~ 'plomberie' OU name ~ 'électricité') ET type = service (OR + AND combinés)",
    domain: domainAND(
      domainOR(
        ["name", "ilike", "plomberie"] as Domain,
        ["name", "ilike", "électricité"] as Domain
      ),
      ["type", "=", "service"] as Domain
    ),
    fields: ["id", "name", "type", "list_price"],
    limit: 10
  }
];

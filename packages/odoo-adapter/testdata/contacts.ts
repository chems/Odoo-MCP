import type { Domain } from "../src/types.js";
import { domainOR, domainAND } from "../src/client.js";

export type ContactTestCase = {
  name: string;
  domain: Domain;
  fields: string[] | ["__all__"];
  limit?: number;
};

export const contactTests: ContactTestCase[] = [
  {
    name: "contacts (is_company = false)",
    domain: [["is_company", "=", false]],
    fields: ["id", "name", "email", "phone", "is_company", "parent_id"],
    limit: 10
  },
  {
    name: "contacts avec email",
    domain: domainAND(
      [["is_company", "=", false]],
      [["email", "!=", false]] as Domain
    ),
    fields: ["id", "name", "email", "phone"],
    limit: 10
  },
  {
    name: "contacts avec email OU téléphone",
    domain: domainAND(
      [["is_company", "=", false]],
      domainOR(
        [["email", "!=", false]] as Domain,
        [["phone", "!=", false]] as Domain
      )
    ),
    fields: ["id", "name", "email", "phone"],
    limit: 10
  },
  {
    name: "contacts d'une entreprise spécifique (parent_id)",
    domain: domainAND(
      [["is_company", "=", false]],
      [["parent_id", "!=", false]] as Domain
    ),
    fields: ["id", "name", "email", "phone", "parent_id", "function"],
    limit: 10
  },
  {
    name: "contacts par nom (ilike)",
    domain: domainAND(
      [["is_company", "=", false]],
      [["name", "ilike", ""]] as Domain
    ),
    fields: ["id", "name", "email"],
    limit: 5
  }
];

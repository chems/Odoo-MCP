import { mcpOdoo } from "@packages/mcp-odoo/client";

// POC: resolve customer via MCP Odoo (search/create)
export async function upsertCustomer(_canon: any, customerHint: any): Promise<number> {
  const name = customerHint?.name ?? "Client à confirmer";
  const found = await mcpOdoo.searchCustomer({ name });
  if (found?.partnerId) return found.partnerId;
  const created = await mcpOdoo.createCustomer({ name });
  return created.partnerId;
}

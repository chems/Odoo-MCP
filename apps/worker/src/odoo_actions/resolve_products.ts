import { mcpOdoo } from "@packages/mcp-odoo/client";

export async function resolveProducts(lines: Array<any>) {
  const resolved = [];
  for (const line of lines ?? []) {
    const query = line.label ?? line.name ?? "";
    const hits = await mcpOdoo.searchProduct({ query });
    if (hits?.length) {
      resolved.push({ ...line, productId: hits[0].id });
      continue;
    }
    const created = await mcpOdoo.createProduct({ name: query || "Service à confirmer", type: "service" });
    resolved.push({ ...line, productId: created.id });
  }
  return resolved;
}

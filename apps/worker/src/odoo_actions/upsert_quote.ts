import { mcpOdoo } from "@packages/mcp-odoo/client";

export async function upsertQuote(input: { partnerId: number; odooMeta: any; lines: any[] }) {
  const so = await mcpOdoo.findOrCreateQuotation({
    partnerId: input.partnerId,
    saleOrderId: input.odooMeta?.saleOrderId as number | undefined,
    opportunityId: input.odooMeta?.opportunityId as number | undefined
  });

  // Read existing lines to avoid duplicates (POC strategy)
  const existing = await mcpOdoo.getQuotationLines({ orderId: so.orderId });
  await mcpOdoo.upsertQuotationLines({ orderId: so.orderId, lines: input.lines, existingLines: existing });
  return so.orderId;
}

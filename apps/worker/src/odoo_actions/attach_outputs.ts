import { mcpOdoo } from "@packages/mcp-odoo/client";

export async function attachOutputs(input: { saleOrderId: number; report: { filename: string; mimetype: string; content: string } }) {
  // Attach report
  await mcpOdoo.attachReport({
    model: "sale.order",
    resId: input.saleOrderId,
    filename: input.report.filename,
    mimetype: input.report.mimetype,
    content: Buffer.from(input.report.content, "utf-8").toString("base64")
  });

  // Post chatter message
  await mcpOdoo.postChatterMessage({
    model: "sale.order",
    resId: input.saleOrderId,
    bodyHtml: "<p>Rapport chantier généré automatiquement.</p>"
  });
}

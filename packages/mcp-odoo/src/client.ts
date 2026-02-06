/**
 * POC client wrapper used by the worker.
 * In real MCP, a host (VSCode/agent) calls the MCP server. Here we model direct calls
 * so the architecture is easy to evolve: you can later swap to real MCP transport.
 */
import { odooCall } from "@building/odoo-adapter/jsonrpc";

export const mcpOdoo = {
  async searchCustomer(input: { name?: string; email?: string; phone?: string }) {
    const q = input.name ?? input.email ?? input.phone ?? "";
    const result = await odooCall("res.partner", "name_search", [q], { limit: 5 });
    if (!result?.length) return null;
    const [id] = result[0];
    return { partnerId: id as number, hits: result.map((r: any) => ({ id: r[0], name: r[1] })) };
  },

  async createCustomer(input: { name: string; email?: string; phone?: string }) {
    const id = await odooCall("res.partner", "create", [[{ name: input.name, email: input.email, phone: input.phone }]]);
    return { partnerId: id as number };
  },

  async searchProduct(input: { query: string }) {
    const result = await odooCall("product.product", "name_search", [input.query], { limit: 5 });
    return (result ?? []).map((r: any) => ({ id: r[0] as number, name: r[1] as string }));
  },

  async createProduct(input: { name: string; type: "service" | "product" }) {
    // Odoo: product.template fields include 'detailed_type' in newer versions; adapt as needed.
    const vals: any = { name: input.name };
    // Many Odoo setups use product.template; for POC we create product.template then rely on variant.
    const templateId = await odooCall("product.template", "create", [[vals]]);
    // Fetch variant product.product id (simplified: search by template_id)
    const prodIds = await odooCall("product.product", "search", [[[["product_tmpl_id", "=", templateId]]]], { limit: 1 });
    const prodId = (prodIds?.[0] ?? null) as number | null;
    return { id: prodId ?? templateId, name: input.name, type: input.type };
  },

  async findOrCreateQuotation(input: { partnerId: number; saleOrderId?: number; opportunityId?: number }) {
    if (input.saleOrderId) return { orderId: input.saleOrderId };
    const id = await odooCall("sale.order", "create", [[{ partner_id: input.partnerId }]]);
    return { orderId: id as number };
  },

  async getQuotationLines(input: { orderId: number }) {
    const ids = await odooCall("sale.order.line", "search", [[[["order_id", "=", input.orderId]]]]);
    if (!ids?.length) return [];
    const lines = await odooCall("sale.order.line", "read", [ids], { fields: ["id", "product_id", "name", "product_uom_qty", "price_unit"] });
    return lines ?? [];
  },

  async upsertQuotationLines(input: { orderId: number; lines: any[]; existingLines: any[] }) {
    // POC strategy: append new lines (no merge). Improve later with matching heuristics.
    for (const l of input.lines ?? []) {
      await odooCall("sale.order.line", "create", [[{
        order_id: input.orderId,
        product_id: l.productId,
        name: l.label ?? l.name ?? "",
        product_uom_qty: l.qty ?? 1,
        price_unit: l.priceUnit ?? 0
      }]]);
    }
    return { ok: true };
  },

  async attachReport(input: { model: string; resId: number; filename: string; mimetype: string; content: string }) {
    // ir.attachment + message_post optional
    const attachmentId = await odooCall("ir.attachment", "create", [[{
      name: input.filename,
      datas: input.content,
      mimetype: input.mimetype,
      res_model: input.model,
      res_id: input.resId
    }]]);
    return { attachmentId };
  },

  async postChatterMessage(input: { model: string; resId: number; bodyHtml: string }) {
    await odooCall(input.model, "message_post", [[input.resId], { body: input.bodyHtml }]);
    return { ok: true };
  }
};

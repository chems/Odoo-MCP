import { extractStep } from "./steps/extract.js";
import { spacesStep } from "./steps/spaces.js";
import { materialsStep } from "./steps/materials.js";
import { laborStep } from "./steps/labor.js";
import { risksStep } from "./steps/risks.js";
import { renderReportStep } from "./steps/render_report.js";
import { upsertCustomer } from "../odoo_actions/upsert_customer.js";
import { resolveProducts } from "../odoo_actions/resolve_products.js";
import { upsertQuote } from "../odoo_actions/upsert_quote.js";
import { attachOutputs } from "../odoo_actions/attach_outputs.js";

export async function runPipeline(input: {
  jobId: string;
  transcription: string;
  odoo: Record<string, unknown>;
  customerHint: Record<string, unknown>;
}) {
  // 1) Extraction structurée
  const extracted = await extractStep(input.transcription);

  // 2) Enrichissements internes (sans référentiel interne)
  const spaces = await spacesStep(input.transcription, extracted);
  const materials = await materialsStep(input.transcription, extracted);
  const labor = await laborStep(input.transcription, extracted);
  const risks = await risksStep(input.transcription, extracted);

  // 3) Construction du JSON canonique chantier (POC)
  const canon = {
    header: extracted.header,
    context: extracted.context,
    technical_analysis: extracted.technical_analysis,
    spaces,
    materials,
    labor,
    risks,
    recommendations: risks.recommendations ?? [],
    next_actions: risks.next_actions ?? [],
    final_summary: extracted.final_summary,
    quote_lines_intent: extracted.quote_lines_intent ?? []
  };

  // 4) Actions Odoo via MCP
  const partnerId = await upsertCustomer(canon, input.customerHint);
  const resolvedLines = await resolveProducts(canon.quote_lines_intent);
  const saleOrderId = await upsertQuote({ partnerId, odooMeta: input.odoo, lines: resolvedLines });

  // 5) Rapport
  const report = await renderReportStep(canon);

  // 6) Attacher outputs dans Odoo
  await attachOutputs({ saleOrderId, report });

  return { jobId: input.jobId, saleOrderId };
}

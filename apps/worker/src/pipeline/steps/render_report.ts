import { renderHtmlReport } from "@packages/report/render_html";

export async function renderReportStep(canon: any) {
  // POC: stable HTML template render
  const html = renderHtmlReport(canon);
  return { filename: "rapport-chantier.html", mimetype: "text/html", content: html };
}

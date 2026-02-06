export function renderHtmlReport(canon: any) {
  const h = canon?.header ?? {};
  const ctx = canon?.context ?? {};
  const tech = canon?.technical_analysis ?? {};

  // POC: HTML stable (12 sections placeholders)
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Rapport Chantier</title></head>
<body>
  <h1>${escapeHtml(h.title ?? "Rapport chantier")}</h1>

  <h2>1- En-tête chantier</h2>
  <pre>${escapeHtml(JSON.stringify(h, null, 2))}</pre>

  <h2>2- Contexte général</h2>
  <p>${escapeHtml(ctx.summary ?? "")}</p>

  <h2>3- Analyse technique globale</h2>
  <p>${escapeHtml(tech.summary ?? "")}</p>

  <h2>4- Détection automatique des espaces</h2>
  <pre>${escapeHtml(JSON.stringify(canon.spaces ?? {}, null, 2))}</pre>

  <h2>5- Synthèse intelligente des surfaces</h2>
  <pre>${escapeHtml(JSON.stringify(canon.surfaces_summary ?? {}, null, 2))}</pre>

  <h2>6- Identification automatique des matériaux et consommables</h2>
  <pre>${escapeHtml(JSON.stringify(canon.materials ?? {}, null, 2))}</pre>

  <h2>7- Calcul intelligent des heures de main-d’œuvre</h2>
  <pre>${escapeHtml(JSON.stringify(canon.labor ?? {}, null, 2))}</pre>

  <h2>8- Outils, engins, protections</h2>
  <pre>${escapeHtml(JSON.stringify(canon.tools_protections ?? [], null, 2))}</pre>

  <h2>9- Contraintes, risques, anomalies</h2>
  <pre>${escapeHtml(JSON.stringify(canon.risks ?? {}, null, 2))}</pre>

  <h2>10- Recommandations professionnelles</h2>
  <pre>${escapeHtml(JSON.stringify(canon.recommendations ?? [], null, 2))}</pre>

  <h2>11- Actions suivantes</h2>
  <pre>${escapeHtml(JSON.stringify(canon.next_actions ?? [], null, 2))}</pre>

  <h2>12- Synthèse finale</h2>
  <p>${escapeHtml(canon.final_summary ?? "")}</p>
</body></html>`;
}

function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * Retire les balises HTML d'un champ Odoo (body/description sont du HTML brut,
 * pouvant contenir tableaux, styles inline et images en base64). Ne tente pas
 * de préserver la mise en forme : produit du texte brut lisible par un LLM.
 */
export function stripHtml(html: string | null | undefined | false): string | null {
  if (!html || typeof html !== 'string') {
    return null;
  }
  const withoutScriptsAndStyles = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const withoutTags = withoutScriptsAndStyles.replace(/<[^>]+>/g, ' ');
  const withEntitiesDecoded = withoutTags.replace(
    /&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g,
    (match) => HTML_ENTITIES[match] ?? match,
  );
  const collapsed = withEntitiesDecoded.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Tronque un texte à `max` caractères, en coupant sur une frontière de mot
 * quand c'est possible, et ajoute une ellipse si le texte a été raccourci.
 */
export function truncate(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) {
    return null;
  }
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const safeCut = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${safeCut.trimEnd()}…`;
}

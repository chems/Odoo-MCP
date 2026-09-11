export interface Many2OneLabel {
  id: number | null;
  label: string | null;
}

/**
 * Extrait id/libellé d'un champ many2one Odoo. Formats gérés défensivement :
 * - `[id, "Display Name"]` (format confirmé par les réponses réelles fournies)
 * - `id` seul (nombre)
 * - `false` (many2one vide, comportement standard Odoo)
 */
export function extractMany2OneLabel(value: unknown): Many2OneLabel {
  if (Array.isArray(value) && value.length >= 2) {
    const [id, label] = value;
    return {
      id: typeof id === 'number' ? id : null,
      label: typeof label === 'string' ? label : null,
    };
  }
  if (typeof value === 'number') {
    return { id: value, label: null };
  }
  return { id: null, label: null };
}

/**
 * Convertit un datetime Odoo `"YYYY-MM-DD HH:MM:SS"` (UTC, sans offset explicite)
 * en ISO 8601. Retourne null si la valeur est absente/vide (`false`).
 */
export function odooDatetimeToIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const isoLike = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

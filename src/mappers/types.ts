export type ResultSource = 'knowledge' | 'helpdesk';

export interface RelatedResultRef {
  source: ResultSource;
  id: number;
  title: string;
  relevanceScore: number;
  reason: string;
}

export interface TicketMessageSummary {
  id: number;
  date: string | null;
  author: string | null;
  type: string | null;
  isInternal: boolean;
  body: string | null;
  subject: string | null;
}

/**
 * Champs propres à un ticket d'assistance, absents du schéma commun.
 * Regroupés ici plutôt qu'ajoutés à `NormalizedResult`, que partage `knowledge`.
 */
export interface HelpdeskDetails {
  team: { id: number | null; label: string | null };
  /** Ids bruts de `tag_ids`, conservés pour résoudre les libellés en un seul appel. */
  tagIds: number[] | null;
  /** Champ Studio « Produit » — l'axe de catégorisation métier de Scolares. */
  product: string | null;
  /** Champ Studio « Fonction » du demandeur. */
  requesterRole: string | null;
  priority: string | null;
  kanbanState: string | null;
  closedAt: string | null;
  ticketRef: string | null;
}

export interface NormalizedResult {
  source: ResultSource;
  id: number;
  title: string;
  summary: string | null;
  content: string | null;
  url: string | null;
  status: string | null;
  tags: string[] | null;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * Absents de la sérialisation tant qu'ils ne sont pas demandés
   * (`includeMessages`) : le fil pèse de 700 à 6000 tokens par ticket.
   */
  history?: TicketMessageSummary[] | null;
  messages?: TicketMessageSummary[] | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
  relatedResults: RelatedResultRef[];
  /** Champs du schéma commun demandés mais non disponibles dans les données Odoo réelles. */
  unavailableFields: string[];
  /** Présent uniquement sur les résultats `helpdesk`. */
  helpdesk?: HelpdeskDetails;
}

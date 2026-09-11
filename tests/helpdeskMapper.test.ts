import { describe, expect, it } from 'vitest';
import { mapHelpdeskTicketToNormalized } from '../src/mappers/helpdeskMapper.js';

describe('helpdeskMapper', () => {
  it('mappe un ticket complet avec stage_id en tuple [id, name]', () => {
    const result = mapHelpdeskTicketToNormalized({
      id: 7006,
      name: 'Modification libellé ou suppression facture',
      partner_id: [23406, 'C.S. Notre-Dame de la Sagesse'],
      description: '<p>Probleme technique</p><table><tr><td>x</td></tr></table>',
      stage_id: [4, 'Solved'],
      user_id: [24, 'Kim Ziegler'],
      create_date: '2024-09-10 13:43:30',
      write_date: '2024-09-12 08:00:00',
      has_message: true,
      message_ids: [1, 2, 3],
    });

    expect(result.source).toBe('helpdesk');
    expect(result.id).toBe(7006);
    expect(result.status).toBe('Solved');
    expect(result.content).toContain('Probleme technique');
    expect(result.content).not.toMatch(/<[^>]+>/);
    expect(result.url).toBeNull();
    // Le fil n'est pas sérialisé tant qu'il n'est pas demandé (lot 5).
    expect(result).not.toHaveProperty('history');
    expect(result).not.toHaveProperty('messages');
    expect(result.createdAt).toBe(new Date('2024-09-10T13:43:30Z').toISOString());
  });

  it('renseigne updatedAt depuis write_date (D4 : le champ était demandé puis jeté)', () => {
    const result = mapHelpdeskTicketToNormalized({
      id: 1,
      name: 'x',
      write_date: '2026-09-02 09:36:07',
    });
    expect(result.updatedAt).toBe(new Date('2026-09-02T09:36:07Z').toISOString());
    expect(result.unavailableFields).not.toContain('updatedAt');
  });

  it("n'annonce plus 'tags' comme indisponible : seule l'URL l'est réellement", () => {
    const result = mapHelpdeskTicketToNormalized({ id: 1, name: 'x', tag_ids: [] });
    expect(result.unavailableFields).toEqual(['url']);
    expect(result.unavailableFields).not.toContain('tags');
  });

  it("gère stage_id = false (many2one vide Odoo) sans planter", () => {
    const result = mapHelpdeskTicketToNormalized({
      id: 42,
      name: 'Ticket sans stage',
      stage_id: false,
    });
    expect(result.status).toBeNull();
  });

  it('tronque la description au-delà de la limite configurée', () => {
    const longDescription = `<pre>${'b'.repeat(5000)}</pre>`;
    const result = mapHelpdeskTicketToNormalized({ id: 5, name: 'Long', description: longDescription });
    expect(result.content!.length).toBeLessThanOrEqual(2001);
  });

  // --- Contrat sur enregistrements figés (lot 6) ---

  describe('enregistrements réels figés', () => {
    it('ticket sans produit ni étiquette ni équipe', () => {
      const result = mapHelpdeskTicketToNormalized({
        id: 41919,
        name: 'Remmarque dvp',
        create_date: '2026-09-02 09:36:07',
        write_date: '2026-09-02 09:36:07',
        stage_id: [1, 'New'],
        team_id: false,
        tag_ids: [],
        priority: '0',
        x_studio_produit: false,
      });

      expect(result.helpdesk?.team).toEqual({ id: null, label: null });
      expect(result.helpdesk?.product).toBeNull();
      expect(result.tags).toEqual([]);
      expect(result.helpdesk?.tagIds).toEqual([]);
    });

    it('ticket catégorisé : produit renseigné et étiquette résolue', () => {
      const result = mapHelpdeskTicketToNormalized(
        {
          id: 41904,
          name: 'Horizon présences',
          create_date: '2026-09-02 09:08:02',
          team_id: [27, 'Horizon Présences'],
          tag_ids: [6],
          priority: '0',
          x_studio_produit: 'Proeco5',
          x_studio_fonction: 'Secrétaire',
        },
        new Map([[6, 'Demande Assistance']]),
      );

      expect(result.helpdesk?.team).toEqual({ id: 27, label: 'Horizon Présences' });
      expect(result.helpdesk?.product).toBe('Proeco5');
      expect(result.helpdesk?.requesterRole).toBe('Secrétaire');
      expect(result.tags).toEqual(['Demande Assistance']);
    });

    it('ticket à plusieurs étiquettes, dont une non résolue', () => {
      const result = mapHelpdeskTicketToNormalized(
        { id: 1, name: 'multi', tag_ids: [5, 6, 99] },
        new Map([
          [5, 'Bug / Incident'],
          [6, 'Demande Assistance'],
        ]),
      );

      expect(result.tags).toEqual(['Bug / Incident', 'Demande Assistance', '#99']);
    });

    it('distingue « étiquettes non demandées » (null) de « sans étiquette » ([])', () => {
      expect(mapHelpdeskTicketToNormalized({ id: 1, name: 'x' }).tags).toBeNull();
      expect(mapHelpdeskTicketToNormalized({ id: 1, name: 'x', tag_ids: [] }).tags).toEqual([]);
      // Odoo renvoie `false` pour un x2many vide selon le contexte.
      expect(mapHelpdeskTicketToNormalized({ id: 1, name: 'x', tag_ids: false }).tags).toEqual([]);
    });
  });
});

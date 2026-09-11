import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FIELDS,
  DEFAULT_FIELDS,
  EXCLUDED_SENSITIVE_FIELDS,
  INSTANCE_CONDITIONAL_FIELDS,
  allowedMethodsFor,
  assertAllowedOperation,
  filterAllowedFields,
  withBaseFields,
} from '../src/security/whitelist.js';
import { OdooOperationNotAllowedError } from '../src/security/errors.js';

describe('whitelist', () => {
  it('accepte knowledge.article + search_read', () => {
    expect(() => assertAllowedOperation('knowledge.article', 'search_read')).not.toThrow();
  });

  it('accepte helpdesk.ticket + search_read', () => {
    expect(() => assertAllowedOperation('helpdesk.ticket', 'search_read')).not.toThrow();
  });

  it('accepte mail.message + search_read pour l’historique des échanges', () => {
    expect(() => assertAllowedOperation('mail.message', 'search_read')).not.toThrow();
  });

  it('autorise les champs métier enrichis de helpdesk.ticket', () => {
    const { fields, ignoredFields } = filterAllowedFields('helpdesk.ticket', [
      'priority',
      'stage_id',
      'kanban_state',
      'user_id',
      'team_id',
      'partner_id',
      'partner_email',
      'partner_phone',
      'assign_date',
      'close_date',
      'date_last_stage_update',
      'message_ids',
    ]);
    expect(fields).toEqual([
      'priority',
      'stage_id',
      'kanban_state',
      'user_id',
      'team_id',
      'partner_id',
      'partner_email',
      'partner_phone',
      'assign_date',
      'close_date',
      'date_last_stage_update',
      'message_ids',
    ]);
    expect(ignoredFields).toEqual([]);
  });

  it('rejette un modèle non whitelisté', () => {
    // `res.users`, `account.move` et `res.company` ne doivent jamais devenir
    // lisibles au détour d'un ajout de modèle.
    for (const model of ['res.users', 'account.move', 'res.company', 'ir.model.data']) {
      expect(() => assertAllowedOperation(model, 'search_read'), model).toThrow(
        OdooOperationNotAllowedError,
      );
    }
  });

  it('rejette une méthode d\'écriture même sur un modèle autorisé', () => {
    expect(() => assertAllowedOperation('knowledge.article', 'write')).toThrow(
      OdooOperationNotAllowedError,
    );
  });

  it('rejette une méthode de lecture non whitelistée sur un modèle autorisé', () => {
    expect(() => assertAllowedOperation('knowledge.article', 'read')).toThrow(
      OdooOperationNotAllowedError,
    );
  });

  it('filterAllowedFields retire les champs hors liste blanche et les reporte', () => {
    const { fields, ignoredFields } = filterAllowedFields('knowledge.article', [
      'name',
      'body',
      'not_a_real_field',
    ]);
    expect(fields).toEqual(['name', 'body']);
    expect(ignoredFields).toEqual(['not_a_real_field']);
  });

  it('filterAllowedFields retombe sur la liste par défaut si aucun champ demandé n\'est valide', () => {
    const { fields, ignoredFields } = filterAllowedFields('helpdesk.ticket', ['bogus']);
    expect(fields.length).toBeGreaterThan(0);
    expect(ignoredFields).toEqual(['bogus']);
  });

  it('autorise write_date sur helpdesk.ticket (checkpoint incrémental de la réindexation sémantique)', () => {
    const { fields, ignoredFields } = filterAllowedFields('helpdesk.ticket', ['id', 'write_date']);
    expect(fields).toEqual(['id', 'write_date']);
    expect(ignoredFields).toEqual([]);
  });

  // --- Matrice explicite par modèle (lot 4) ---

  describe('matrice par modèle', () => {
    it('accepte les agrégats sur helpdesk.ticket', () => {
      expect(() => assertAllowedOperation('helpdesk.ticket', 'search_count')).not.toThrow();
      expect(() => assertAllowedOperation('helpdesk.ticket', 'read_group')).not.toThrow();
    });

    it("n'ouvre PAS les agrégats aux autres modèles au passage", () => {
      // Le piège d'un produit cartésien modèles × méthodes : ajouter read_group
      // l'aurait autorisé partout d'office.
      expect(() => assertAllowedOperation('knowledge.article', 'read_group')).toThrow(
        OdooOperationNotAllowedError,
      );
      expect(() => assertAllowedOperation('knowledge.article', 'search_count')).toThrow(
        OdooOperationNotAllowedError,
      );
      expect(() => assertAllowedOperation('mail.message', 'read_group')).toThrow(
        OdooOperationNotAllowedError,
      );
      expect(() => assertAllowedOperation('helpdesk.tag', 'read_group')).toThrow(
        OdooOperationNotAllowedError,
      );
    });

    it('expose helpdesk.team et helpdesk.tag en lecture seule', () => {
      expect(() => assertAllowedOperation('helpdesk.team', 'search_read')).not.toThrow();
      expect(() => assertAllowedOperation('helpdesk.tag', 'search_read')).not.toThrow();
      expect(allowedMethodsFor('helpdesk.tag')).toEqual(['search_read']);
    });

    it('n\'expose aucun champ personnel des équipes', () => {
      expect(ALLOWED_FIELDS['helpdesk.team']).not.toContain('member_ids');
    });
  });

  // --- res.partner : liste blanche explicite, jamais une exclusion ---

  describe('res.partner', () => {
    it('exclut les champs comptables, bancaires et de facturation', () => {
      for (const champ of [
        'vat', 'bank_ids', 'debit_limit', 'payment_token_ids', 'invoice_ids',
        'property_account_payable_id', 'property_account_receivable_id',
        'property_payment_term_id', 'supplier_rank', 'customer_rank', 'trust',
        'unpaid_invoice_ids', 'journal_item_count',
      ]) {
        expect(ALLOWED_FIELDS['res.partner'], champ).not.toContain(champ);
      }
    });

    it('exclut tous les champs binaires (images, avatars)', () => {
      for (const champ of ALLOWED_FIELDS['res.partner']) {
        expect(champ.startsWith('image_'), champ).toBe(false);
        expect(champ.startsWith('avatar_'), champ).toBe(false);
      }
    });

    it('exclut les seize variantes _1, mesurées intégralement vides', () => {
      const variantes = ALLOWED_FIELDS['res.partner'].filter(
        (f) => f.startsWith('x_studio_') && f.endsWith('_1'),
      );
      expect(variantes).toEqual([]);
    });

    it('expose les champs métier dont dépend la résolution FASE → école', () => {
      for (const champ of ['x_studio_fase', 'x_studio_fase_po', 'x_studio_rseau', 'x_studio_niveau']) {
        expect(ALLOWED_FIELDS['res.partner'], champ).toContain(champ);
      }
    });

    it('garde un profil court nettement plus étroit que la liste blanche', () => {
      const court = DEFAULT_FIELDS['res.partner'];
      expect(court.length).toBeLessThan(ALLOWED_FIELDS['res.partner'].length / 2);
      for (const champ of court) {
        expect(ALLOWED_FIELDS['res.partner'], champ).toContain(champ);
      }
    });
  });

  // --- Garde de sécurité : lecture seule (contrainte n°1 du plan) ---

  describe('garde lecture seule', () => {
    const MODELES = [
      'knowledge.article',
      'helpdesk.ticket',
      'mail.message',
      'helpdesk.team',
      'helpdesk.tag',
      'res.partner',
      'res.partner.category',
    ];
    const ECRITURES = [
      'create',
      'write',
      'unlink',
      'copy',
      'action_archive',
      'action_unarchive',
      'name_create',
      'load',
      'import_data',
      'web_save',
      'button_immediate_install',
    ];

    it('refuse toute méthode d\'écriture sur TOUS les modèles autorisés', () => {
      for (const model of MODELES) {
        for (const method of ECRITURES) {
          expect(() => assertAllowedOperation(model, method), `${model}.${method}`).toThrow(
            OdooOperationNotAllowedError,
          );
        }
      }
    });

    it('refuse aussi les lectures non nécessaires (introspection, exécution)', () => {
      // `fields_get` est en lecture, mais volontairement hors runtime :
      // l'introspection a eu lieu une fois, à la conception.
      for (const method of ['read', 'fields_get', 'search', 'execute', 'browse', 'default_get']) {
        expect(() => assertAllowedOperation('helpdesk.ticket', method), method).toThrow(
          OdooOperationNotAllowedError,
        );
      }
    });

    it('nomme le modèle et la méthode refusés', () => {
      expect(() => assertAllowedOperation('res.users', 'write')).toThrow(
        /model="res.users".*method="write"/,
      );
    });
  });

  // --- Motif du rejet d'un champ (lot 8) ---

  describe('motif du rejet des champs', () => {
    it('distingue un champ existant non exposé d\'un champ inexistant', () => {
      const { ignoredFieldsDetail } = filterAllowedFields('helpdesk.ticket', [
        'id',
        'access_token',
        'ticket_type_id',
        'category_id',
      ]);
      expect(ignoredFieldsDetail).toEqual([
        // Existe sur le modèle, délibérément non exposé (jeton d'accès portail).
        { field: 'access_token', reason: 'non_expose' },
        // Ces deux-là n'existent pas sur helpdesk.ticket en Odoo 18 : pendant les
        // sondages du 08/09 ils apparaissaient côte à côte avec des champs bien
        // réels, sans que rien ne les distingue.
        { field: 'ticket_type_id', reason: 'inconnu' },
        { field: 'category_id', reason: 'inconnu' },
      ]);
    });

    it('conserve ignoredFields sous sa forme historique', () => {
      const { ignoredFields } = filterAllowedFields('helpdesk.ticket', ['id', 'ticket_type_id']);
      expect(ignoredFields).toEqual(['ticket_type_id']);
    });
  });

  // --- D9 : la liste blanche ne doit demander que des champs réels ---

  describe('cohérence avec le modèle Odoo réel', () => {
    it('couvre tout le modèle helpdesk.ticket relevé en production', () => {
      // 114 champs au fields_get, moins access_token = 113 demandables.
      expect(ALLOWED_FIELDS['helpdesk.ticket'].length).toBe(113);
    });

    it("n'expose jamais access_token, même si le champ existe", () => {
      // Combiné à access_url, il ouvrirait le ticket sans authentification.
      expect(ALLOWED_FIELDS['helpdesk.ticket']).not.toContain('access_token');
      expect(Object.keys(EXCLUDED_SENSITIVE_FIELDS)).toContain('access_token');
    });

    it('inclut les axes de catégorisation réellement disponibles', () => {
      expect(ALLOWED_FIELDS['helpdesk.ticket']).toContain('x_studio_produit');
      expect(ALLOWED_FIELDS['helpdesk.ticket']).toContain('tag_ids');
    });

    it('ne demande AUCUN champ dépendant de l\'instance par défaut (D9)', () => {
      // sale_order_id/sale_order_state existent en production mais pas sur la
      // copie de test : les demander d'office faisait échouer l'appel entier.
      for (const field of INSTANCE_CONDITIONAL_FIELDS) {
        expect(ALLOWED_FIELDS['helpdesk.ticket'], `${field} demandable`).toContain(field);
        expect(DEFAULT_FIELDS['helpdesk.ticket'], `${field} hors défaut`).not.toContain(field);
      }
    });

    it('garde les champs par défaut nettement plus étroits que la liste blanche', () => {
      const defauts = DEFAULT_FIELDS['helpdesk.ticket'];
      expect(defauts.length).toBeLessThan(ALLOWED_FIELDS['helpdesk.ticket'].length / 2);
      // Ni binaire, ni blob JSON, ni tableau d'ids non borné dans le défaut.
      for (const lourd of [
        'rating_last_image',
        'properties',
        'duration_tracking',
        'partner_ticket_ids',
        'domain_user_ids',
        'message_follower_ids',
        'website_message_ids',
      ]) {
        expect(defauts, lourd).not.toContain(lourd);
        expect(ALLOWED_FIELDS['helpdesk.ticket'], lourd).toContain(lourd);
      }
    });

    it('tout champ par défaut est dans la liste blanche', () => {
      for (const field of DEFAULT_FIELDS['helpdesk.ticket']) {
        expect(ALLOWED_FIELDS['helpdesk.ticket'], field).toContain(field);
      }
    });
  });

  describe('withBaseFields', () => {
    it('ajoute le socle sans doublon et en préservant l\'ordre demandé', () => {
      expect(withBaseFields(['id'], ['id', 'team_id', 'tag_ids'])).toEqual(['id', 'team_id', 'tag_ids']);
      expect(withBaseFields(['name', 'id'], ['id', 'team_id'])).toEqual(['name', 'id', 'team_id']);
    });
  });
});

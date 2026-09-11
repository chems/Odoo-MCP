import { describe, expect, it } from 'vitest';
import { mapKnowledgeArticleToNormalized } from '../src/mappers/knowledgeMapper.js';

describe('knowledgeMapper', () => {
  it('mappe un article complet et signale tags comme non disponible', () => {
    const result = mapKnowledgeArticleToNormalized({
      id: 1669,
      name: 'CAMMAT',
      parent_id: [1152, '📄 Absences complètes'],
      website_url: 'https://scolares.odoo.com/knowledge/article/1669',
      article_url: 'https://scolares.odoo.com/knowledge/article/1669',
      active: true,
      is_locked: false,
      is_published: true,
      website_published: true,
      body: '<h2><strong>CAMMAT</strong></h2><p>La CAMMAT est un mode de transmission.</p>',
      summary: 'Résumé natif',
      create_date: '2024-09-10 13:43:30',
      write_date: '2024-09-11 08:00:00',
    });

    expect(result.source).toBe('knowledge');
    expect(result.id).toBe(1669);
    expect(result.title).toBe('CAMMAT');
    expect(result.summary).toBe('Résumé natif');
    expect(result.content).toContain('La CAMMAT est un mode de transmission.');
    expect(result.content).not.toContain('<p>');
    expect(result.url).toBe('https://scolares.odoo.com/knowledge/article/1669');
    expect(result.status).toBe('published');
    expect(result.tags).toBeNull();
    expect(result.unavailableFields).toContain('tags');
    expect(result.createdAt).toBe(new Date('2024-09-10T13:43:30Z').toISOString());
    expect(result.updatedAt).toBe(new Date('2024-09-11T08:00:00Z').toISOString());
  });

  it('gère un article archivé (active=false) sans planter', () => {
    const result = mapKnowledgeArticleToNormalized({
      id: 2,
      name: 'Vieil article',
      active: false,
      is_locked: false,
      is_published: false,
    });
    expect(result.status).toBe('archived');
  });

  it('gère un parent_id vide (false, many2one vide Odoo)', () => {
    const result = mapKnowledgeArticleToNormalized({
      id: 3,
      name: 'Sans parent',
      parent_id: false,
    });
    expect(result.id).toBe(3);
  });

  it('tronque le contenu au-delà de la limite configurée', () => {
    const longBody = `<p>${'a'.repeat(5000)}</p>`;
    const result = mapKnowledgeArticleToNormalized({ id: 4, name: 'Long', body: longBody });
    expect(result.content!.length).toBeLessThanOrEqual(2001); // +1 pour l'ellipse
  });
});

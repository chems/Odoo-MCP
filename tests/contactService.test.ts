import { describe, expect, it, vi } from 'vitest';
import {
  ContactNotFoundError,
  computeContactStats,
  getContact,
  listContactFieldValues,
  resolveSchoolFromTicket,
  searchSchools,
} from '../src/services/contactService.js';
import {
  ContactStatsSchema,
  GetContactSchema,
  ListContactFieldValuesSchema,
  SearchSchoolsSchema,
} from '../src/schemas/contacts.js';
import { mapPartnerToContact } from '../src/mappers/contactMapper.js';
import type { OdooClient, SearchReadParams } from '../src/clients/odooClient.js';

const ECOLE = {
  id: 125,
  name: "Institut Sainte-Marie d'Arlon",
  ref: 'A-125',
  is_company: true,
  active: true,
  x_studio_fase: '2462',
  x_studio_fase_po: '1057',
  x_studio_rseau: 'Libre SeGEC',
  x_studio_niveau: 'Secondaire Ordinaire',
  x_studio_nombre_dlves: 812,
  city: 'Arlon',
  zip: '6700',
};

interface Calls {
  searchRead: SearchReadParams[];
}

function makeClient(options: {
  partners?: Record<string, unknown>[];
  total?: number;
  groups?: Record<string, unknown>[];
  tickets?: Record<string, unknown>[];
} = {}) {
  const calls: Calls = { searchRead: [] };
  const client = {
    searchRead: vi.fn(async (params: SearchReadParams) => {
      calls.searchRead.push(params);
      if (params.model === 'res.partner.category') return [{ id: 3, name: 'Client' }];
      if (params.model === 'helpdesk.ticket') return options.tickets ?? [];
      return options.partners ?? [ECOLE];
    }),
    searchCount: vi.fn(async () => options.total ?? 1),
    readGroup: vi.fn(async () => options.groups ?? []),
  } as unknown as OdooClient;
  return { client, calls };
}

const partnerCalls = (calls: Calls) => calls.searchRead.filter((c) => c.model === 'res.partner');

describe('searchSchools', () => {
  it('restreint toujours aux sociétés', async () => {
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({ ville: 'Arlon' }));
    expect(partnerCalls(calls)[0]!.domain).toContainEqual(['is_company', '=', true]);
  });

  it('distingue count (page) de total (correspondances)', async () => {
    const { client } = makeClient({ total: 2065 });
    const r = await searchSchools(client, SearchSchoolsSchema.parse({}));
    expect(r.count).toBe(1);
    expect(r.total).toBe(2065);
    expect(r.hasMore).toBe(true);
  });

  it('trie de façon déterministe, départagé par id', async () => {
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({}));
    expect(partnerCalls(calls)[0]!.order).toBe('name asc, id asc');

    const { client: c2, calls: k2 } = makeClient();
    await searchSchools(c2, SearchSchoolsSchema.parse({ order: 'nombreEleves desc' }));
    expect(partnerCalls(k2)[0]!.order).toBe('x_studio_nombre_dlves desc, id asc');
  });

  it('découpe la recherche par nom en termes (casse, ponctuation, ordre)', async () => {
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({ nom: 'Sainte-Marie Arlon' }));
    const domain = partnerCalls(calls)[0]!.domain;
    expect(domain).toContainEqual(['name', 'ilike', 'Sainte']);
    expect(domain).toContainEqual(['name', 'ilike', 'Marie']);
    expect(domain).toContainEqual(['name', 'ilike', 'Arlon']);
  });

  it('couvre les FASE composites dans le domaine', async () => {
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({ fase: 5448 }));
    const domain = JSON.stringify(partnerCalls(calls)[0]!.domain);
    expect(domain).toContain('"5448/%"');
    expect(domain).toContain('"%/5448"');
  });

  it('explique la normalisation FASE appliquée', async () => {
    const { client } = makeClient();
    const r = await searchSchools(client, SearchSchoolsSchema.parse({ fase: '03003' }));
    expect(r.notes.some((n) => n.includes('sans zéro de tête'))).toBe(true);
  });

  it('avertit quand un FASE correspond à plusieurs fiches', async () => {
    const { client } = makeClient({ total: 2 });
    const r = await searchSchools(client, SearchSchoolsSchema.parse({ fase: 541 }));
    expect(r.notes.some((n) => n.includes("n'est pas unique"))).toBe(true);
  });

  it('borne le nombre d\'élèves', async () => {
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({ nombreElevesMin: 100, nombreElevesMax: 500 }));
    const domain = partnerCalls(calls)[0]!.domain;
    expect(domain).toContainEqual(['x_studio_nombre_dlves', '>=', 100]);
    expect(domain).toContainEqual(['x_studio_nombre_dlves', '<=', 500]);
  });

  it('compare le logiciel comptable sans tenir compte de la casse', async () => {
    // Mesuré : « ComptEco » (656), « compteco » (6), « Compteco » (3) cohabitent.
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({ logicielComptable: 'compteco' }));
    expect(partnerCalls(calls)[0]!.domain).toContainEqual([
      'x_studio_logiciel_comptable',
      'ilike',
      'compteco',
    ]);
  });

  it('n\'inclut les archivés que sur demande', async () => {
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({}));
    expect(partnerCalls(calls)[0]!.context).toBeUndefined();

    const { client: c2, calls: k2 } = makeClient();
    await searchSchools(c2, SearchSchoolsSchema.parse({ includeArchived: true }));
    expect(partnerCalls(k2)[0]!.context).toEqual({ active_test: false });
  });

  it('demande le profil court par défaut, complet sur demande', async () => {
    const { client, calls } = makeClient();
    await searchSchools(client, SearchSchoolsSchema.parse({}));
    const court = partnerCalls(calls)[0]!.fields;
    expect(court).not.toContain('x_studio_license_proeco');

    const { client: c2, calls: k2 } = makeClient();
    await searchSchools(c2, SearchSchoolsSchema.parse({ profile: 'full' }));
    expect(partnerCalls(k2)[0]!.fields).toContain('x_studio_license_proeco');
  });
});

describe('getContact', () => {
  it('résout FASE → école', async () => {
    const { client } = makeClient();
    const r = await getContact(client, GetContactSchema.parse({ fase: 2462 }));
    expect(r.results[0]!.nom).toBe("Institut Sainte-Marie d'Arlon");
    expect(r.results[0]!.reseau).toBe('Libre SeGEC');
  });

  it('renvoie une LISTE quand plusieurs fiches partagent le FASE', async () => {
    // 14 numéros sont partagés : renvoyer « la » fiche en choisirait une au hasard.
    const { client } = makeClient({
      partners: [
        { ...ECOLE, id: 231, name: 'Lycée Mater Dei - 1', x_studio_fase: '541' },
        { ...ECOLE, id: 28459, name: 'Lycée Mater Dei - 2', x_studio_fase: '541' },
      ],
    });
    const r = await getContact(client, GetContactSchema.parse({ fase: 541 }));
    expect(r.count).toBe(2);
    expect(r.notes.some((n) => n.includes('2 fiches portent ce FASE'))).toBe(true);
  });

  it('exige id ou fase', () => {
    expect(() => GetContactSchema.parse({})).toThrow();
    expect(() => GetContactSchema.parse({ fase: 3003 })).not.toThrow();
    expect(() => GetContactSchema.parse({ id: 125 })).not.toThrow();
  });

  it('en cas d\'échec, dit ce qui aurait fonctionné', async () => {
    // Le numéro n'est pas un FASE d'école mais un FASE de P.O.
    let appel = 0;
    const client = {
      searchRead: vi.fn(async () => []),
      searchCount: vi.fn(async () => (appel++ === 0 ? 7 : 0)),
      readGroup: vi.fn(async () => []),
    } as unknown as OdooClient;

    await expect(getContact(client, GetContactSchema.parse({ fase: 1057 }))).rejects.toThrow(
      /FASE de pouvoir organisateur.*fasePo/s,
    );
  });

  it('joint les contacts rattachés sur demande', async () => {
    const { client, calls } = makeClient();
    await getContact(client, GetContactSchema.parse({ fase: 2462, includeChildren: true }));
    const appelEnfants = partnerCalls(calls).find((c) =>
      JSON.stringify(c.domain).includes('parent_id'),
    );
    expect(appelEnfants).toBeDefined();
  });
});

describe('listContactFieldValues', () => {
  it('renvoie le lexique réel avec les effectifs', async () => {
    const { client } = makeClient({
      total: 2065,
      groups: [
        { x_studio_rseau: 'Libre SeGEC', __count: 1372 },
        { x_studio_rseau: false, __count: 376 },
        { x_studio_rseau: 'Communal', __count: 162 },
      ],
    });
    const r = await listContactFieldValues(client, ListContactFieldValuesSchema.parse({ champ: 'reseau' }));
    expect(r.odooField).toBe('x_studio_rseau');
    expect(r.valeurs[0]).toEqual({ valeur: 'Libre SeGEC', count: 1372 });
    expect(r.valeurs.find((v) => v.valeur === null)?.count).toBe(376);
  });

  it('refuse un axe inconnu en nommant les axes acceptés', async () => {
    const { client } = makeClient();
    await expect(
      listContactFieldValues(client, { champ: 'inexistant', limit: 50, includeArchived: false }),
    ).rejects.toThrow(/Axes acceptés/);
  });
});

describe('computeContactStats', () => {
  it('prend le total de search_count, pas de la somme des groupes', async () => {
    const { client } = makeClient({
      total: 2065,
      groups: [
        { x_studio_rseau: 'Libre SeGEC', __count: 1372 },
        { x_studio_rseau: 'Communal', __count: 162 },
      ],
    });
    const r = await computeContactStats(client, ContactStatsSchema.parse({ groupBy: ['reseau'] }));
    expect(r.total).toBe(2065);
    expect(r.sumOfGroups).toBe(1534);
  });

  it('avertit sur un axe peu renseigné', async () => {
    const { client } = makeClient({ total: 2065, groups: [{ x_studio_diocse: 'Namur', __count: 12 }] });
    const r = await computeContactStats(client, ContactStatsSchema.parse({ groupBy: ['diocese'] }));
    expect(r.warnings.some((w) => w.includes('40 %'))).toBe(true);
  });

  it('avertit sur un axe multivalué', async () => {
    const { client } = makeClient({ total: 10, groups: [] });
    const r = await computeContactStats(client, ContactStatsSchema.parse({ groupBy: ['etiquettes'] }));
    expect(r.warnings.some((w) => w.includes('multivalué'))).toBe(true);
  });

  it('refuse un axe non regroupable', async () => {
    const { client } = makeClient();
    await expect(
      computeContactStats(client, {
        groupBy: ['fase'],
        includeArchived: false,
        limit: 100,
      } as never),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
  });
});

describe('resolveSchoolFromTicket', () => {
  it('résout directement quand le client porte un FASE', async () => {
    const client = {
      searchRead: vi.fn(async (p: SearchReadParams) =>
        p.model === 'helpdesk.ticket'
          ? [{ id: 42760, name: 'Souci', partner_id: [125, 'Institut Sainte-Marie'] }]
          : [ECOLE],
      ),
      searchCount: vi.fn(async () => 1),
      readGroup: vi.fn(async () => []),
    } as unknown as OdooClient;

    const r = await resolveSchoolFromTicket(client, 42760);
    expect(r.voie).toBe('direct');
    expect(r.ecole?.fase).toBe('2462');
  });

  it('remonte au parent quand le client est une personne (78 % des cas)', async () => {
    const personne = { id: 900, name: 'Marie Dupont', is_company: false, parent_id: [125, 'Institut'] };
    let appelPartner = 0;
    const client = {
      searchRead: vi.fn(async (p: SearchReadParams) => {
        if (p.model === 'helpdesk.ticket') return [{ id: 1, partner_id: [900, 'Marie Dupont'] }];
        return appelPartner++ === 0 ? [personne] : [ECOLE];
      }),
      searchCount: vi.fn(async () => 1),
      readGroup: vi.fn(async () => []),
    } as unknown as OdooClient;

    const r = await resolveSchoolFromTicket(client, 1);
    expect(r.voie).toBe('parent');
    expect(r.ecole?.fase).toBe('2462');
    expect(r.notes.some((n) => n.includes('rattachement parent'))).toBe(true);
  });

  it('le dit franchement quand rien ne se résout', async () => {
    const client = {
      searchRead: vi.fn(async (p: SearchReadParams) =>
        p.model === 'helpdesk.ticket'
          ? [{ id: 2, partner_id: [901, 'Anonyme'] }]
          : [{ id: 901, name: 'Anonyme', is_company: false, parent_id: false }],
      ),
      searchCount: vi.fn(async () => 0),
      readGroup: vi.fn(async () => []),
    } as unknown as OdooClient;

    const r = await resolveSchoolFromTicket(client, 2);
    expect(r.voie).toBe('introuvable');
    expect(r.ecole).toBeNull();
  });

  it('gère un ticket sans client', async () => {
    const client = {
      searchRead: vi.fn(async () => [{ id: 3, partner_id: false }]),
      searchCount: vi.fn(async () => 0),
      readGroup: vi.fn(async () => []),
    } as unknown as OdooClient;
    const r = await resolveSchoolFromTicket(client, 3);
    expect(r.voie).toBe('introuvable');
    expect(r.partenaire).toBeNull();
  });

  it('refuse un ticket inexistant', async () => {
    const client = {
      searchRead: vi.fn(async () => []),
      searchCount: vi.fn(async () => 0),
      readGroup: vi.fn(async () => []),
    } as unknown as OdooClient;
    await expect(resolveSchoolFromTicket(client, 999)).rejects.toBeInstanceOf(ContactNotFoundError);
  });
});

describe('mapPartnerToContact — contrat sur enregistrements figés', () => {
  it('société sans parent (cas de la totalité des 2 065 sociétés)', () => {
    const c = mapPartnerToContact({ ...ECOLE, parent_id: false });
    expect(c.parent).toBeNull();
    expect(c.estSociete).toBe(true);
  });

  it('école rattachée à un P.O. multi-écoles', () => {
    const c = mapPartnerToContact({
      ...ECOLE,
      x_studio_fase_po: '1057',
      x_studio_appartient_po_multi_cole: true,
    });
    expect(c.fasePo).toBe('1057');
    expect(c.appartientPoMultiEcole).toBe(true);
  });

  it('FASE composite décomposé en ses numéros', () => {
    const c = mapPartnerToContact({ ...ECOLE, x_studio_fase: '5448/3048' });
    expect(c.fase).toBe('5448/3048');
    expect(c.faseParts).toEqual(['5448', '3048']);
  });

  it('signale les champs demandés mais vides', () => {
    const c = mapPartnerToContact({ id: 1, name: 'X', x_studio_fase: false, x_studio_rseau: false });
    expect(c.champsVides).toContain('fase');
    expect(c.champsVides).toContain('reseau');
  });

  it('distingue un booléen faux d\'un champ non demandé', () => {
    // Champ demandé et valant false → la clé existe et vaut false.
    const demande = mapPartnerToContact({ id: 1, x_studio_module_frais: false });
    expect(demande.equipement).toEqual({ moduleFrais: false });
    // Champ non demandé → la clé est absente, pas nulle.
    const absent = mapPartnerToContact({ id: 1, x_studio_license_proeco: 'L1' });
    expect(absent.equipement).toEqual({ licenceProeco: 'L1' });
    expect(absent.equipement).not.toHaveProperty('moduleFrais');
  });

  it('le profil court n\'émet ni bloc équipement ni clés non demandées', () => {
    const court = mapPartnerToContact({
      id: 125,
      name: 'X',
      x_studio_fase: '2462',
      x_studio_rseau: 'Libre SeGEC',
      city: 'Arlon',
      zip: '6700',
    });
    expect(court.equipement).toBeUndefined();
    expect(court).not.toHaveProperty('edid');
    expect(court).not.toHaveProperty('diocese');
    // Le bloc contact ne porte que les deux champs demandés.
    expect(court.contact).toEqual({ codePostal: '6700', ville: 'Arlon' });
    // Numéro simple : pas de faseParts redondant.
    expect(court).not.toHaveProperty('faseParts');
  });

  it('résout les étiquettes en libellés', () => {
    const c = mapPartnerToContact({ ...ECOLE, category_id: [3, 9] }, new Map([[3, 'Client']]));
    expect(c.etiquettes).toEqual(['Client', '#9']);
  });
});

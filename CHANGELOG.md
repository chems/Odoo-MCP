# Changelog

## 2.1.0 — 09/09/2026 — module Contacts (écoles)

Mise en œuvre de `PLAN-service-contacts-lecture.md`, lots 0 à 6. Les mesures qui
fondent ces choix sont dans [CONTACTS-lot1-correspondance.md](CONTACTS-lot1-correspondance.md).

### Ajouté

Six outils, tous en lecture seule et restreints aux **sociétés** (`is_company = true`) :

- **`describe_contact_fields`** — dictionnaire des champs : nom métier, type,
  valeurs admises, **taux de remplissage mesuré**, avertissements. C'est lui qui
  rend les cinq autres utilisables sans documentation externe.
- **`search_schools`** — recherche par filtres nommés et typés. Aucun domaine
  Odoo brut n'est exposé.
- **`get_contact`** — fiche par identifiant ou **par numéro FASE**.
- **`list_contact_field_values`** — lexique réel d'un axe, avec effectifs.
- **`contact_stats`** — comptage et ventilation (`search_count` + `read_group`),
  même contrat que `helpdesk_stats`.
- **`resolve_school_from_ticket`** — jointure Assistance → Contacts.

Modèles ajoutés à la liste blanche : `res.partner` (search_read, search_count,
read_group) et `res.partner.category` (search_read).

### Ce que les mesures ont corrigé dans la conception

- **Les seize paires `x_studio_*` / `x_studio_*_1`** que le plan tenait pour le
  risque bloquant : les seize variantes `_1` sont **intégralement vides** sur
  2 065 sociétés. Règle uniforme, toujours le champ sans suffixe ; les variantes
  restent hors liste blanche.
- **Le FASE n'identifie pas une école de façon unique** : 14 numéros sont
  partagés. `get_contact` renvoie une liste, jamais une fiche choisie au hasard.
- **`parent_id` est vide sur la totalité des sociétés** : le rattachement au
  pouvoir organisateur est textuel (`fasePo`), pas relationnel.
- **Le piège FASE n'est pas la comparaison entier/chaîne** (Odoo coerce pour `=`)
  ni les zéros de tête (aucun dans les données), mais les **76 numéros
  composites** `a/b`, désormais reconnus depuis une seule moitié.
- **192 champs sur `res.partner`**, pas 254 : le relevé de référence décrit une
  autre base. Les 34 champs métier visés sont tous présents.

### Sécurité

- Liste blanche **explicite**, jamais une exclusion : un champ Studio ajouté plus
  tard n'entre pas dans le périmètre par inadvertance.
- Sont hors périmètre : les 44 champs comptables, bancaires et de facturation,
  les 12 champs binaires (images, avatars) et les variantes `_1`.
- **Les personnes physiques ne sont pas exposées.** `search_contacts` du §3 du
  plan n'est pas livré : le §5 exige de vérifier auprès du responsable du
  traitement que l'exposition de courriels nominatifs à un assistant est couverte
  par le registre existant. 12 203 personnes sont concernées. Question ouverte.

### Confort

- Le message d'erreur de configuration explique désormais **d'où** doivent venir
  les variables : `npm start` / `npm run dev` lisent `.env`, tandis qu'un client
  MCP les passe par le bloc `env` de sa configuration. Un `node dist/index.js`
  lancé à la main échouait avec « Expected number, received nan » sans dire quoi
  faire.

## 2.0.0 — 09/09/2026

Mise en œuvre de `PLAN-amelioration-claude-code.md`. Les mesures qui justifient
ces changements sont dans [DIAGNOSTIC-D8.md](DIAGNOSTIC-D8.md).

### ⚠ Ruptures de compatibilité

**1. `search_helpdesk` — l'ordre des résultats change** (défaut D2)

Aucun `order` n'était transmis à Odoo, qui appliquait son tri par défaut
`priority desc, id desc` : les tickets prioritaires remontaient en tête, puis les
autres par id décroissant. La page était ensuite re-triée côté client par score
de pertinence. Une pagination pouvait donc dupliquer ou omettre des tickets sans
rien signaler.

Désormais : `order` par défaut `create_date desc`, toujours transmis, systématiquement
départagé par `id desc`. Le re-tri client par `relevanceScore` est supprimé — le
score reste calculé et exposé, l'appelant peut trier lui-même.

**2. `search_helpdesk` — `includeMessages` passe à `false` par défaut** (défaut D6)

Le fil de messages complet était sérialisé pour chaque ticket, même avec
`fields: ["id"]`, et recopié **deux fois** (`history` **et** `messages`). Un appel
sur 50 tickets pesait ~380 Ko.

Désormais, les clés `history` et `messages` sont **absentes** de la sortie tant que
`includeMessages: true` n'est pas passé. Un appelant qui lisait `history` sans le
demander doit soit passer `includeMessages: true`, soit utiliser
`get_helpdesk_ticket_messages`, qui existe déjà pour ça.

**3. `get_helpdesk_ticket_messages` — `limit` plafonné à 50 au lieu de 200**

Le schéma annonçait 200, mais le service replafonnait à `MCP_MAX_RESULTS_PER_QUERY`
(50) : la valeur annoncée n'était jamais atteignable. Le schéma dit maintenant la vérité.

### Corrigé

- **Le connecteur échouait sur tout appel sans `fields`, selon l'instance.**
  `sale_order_id` et `sale_order_state` existent en production mais pas sur les
  copies de test où le module Ventes n'est pas installé. Les champs par défaut
  valant la liste blanche entière, Odoo renvoyait `Invalid field 'sale_order_id'`
  et faisait échouer **l'appel entier**. `DEFAULT_FIELDS` est désormais découplé
  de `ALLOWED_FIELDS` : ces champs restent demandables, jamais imposés.
- `tags` était forcé à `null` et déclaré dans `unavailableFields`, laissant croire
  que la donnée n'existait pas côté Odoo. Les étiquettes sont maintenant résolues
  en libellés via `helpdesk.tag`, en un seul appel pour toute la page.
- `updatedAt` était `null` alors que `write_date` était demandé à Odoo puis jeté.
- La liste blanche d'opérations était un **produit cartésien** modèles × méthodes :
  ajouter une méthode l'aurait autorisée sur tous les modèles. Elle est maintenant
  explicite par modèle.

### Ajouté

- **Couverture complète du modèle `helpdesk.ticket`** : la liste blanche passe de
  31 à **113 champs**, soit les 114 champs relevés en production moins
  `access_token`. Sont désormais accessibles les SLA (`sla_deadline`, `sla_fail`,
  `sla_success`…), les évaluations (`rating_*`), les délais de réponse
  (`first_response_hours`, `avg_response_hours`, `total_response_hours`), les
  activités, la provenance (`campaign_id`, `source_id`, `medium_id`) et les
  champs Studio restants (`x_studio_etablissement_1`, `x_studio_n_fase`,
  `x_studio_fase_tabl`…).
- **`url` est enfin renseigné** sur les tickets, à partir de `access_url`
  (`/my/ticket/<id>` préfixé par `ODOO_BASE_URL`). `unavailableFields` est
  désormais vide sur un ticket normal.
- **`helpdesk_stats`** — compte et ventile les tickets en un seul appel
  (`search_count` + `read_group`), 1 à 3 axes, sans les récupérer. `total` vient
  toujours de `search_count`, jamais de la somme des groupes ; `sumOfGroups` est
  exposé à côté pour rendre tout écart visible. Avertissements structurés sur les
  axes multivalués, la troncature et le fuseau.
- **`list_helpdesk_teams`** — relie un `teamId` à un nom d'équipe.
- `search_helpdesk` : `query` devient **facultatif** ; nouveaux paramètres `order`,
  `createdAfter`, `createdBefore`, `lastDays`, `product`, `includeMessages`,
  `messageLimit`.
- Enveloppe de `search_helpdesk` : `total` (correspondances) à côté de `count`
  (taille de page), plus `order`, `period`, `offset` et `ignoredFieldsDetail`.
- `ignoredFieldsDetail` distingue `non_expose` (le champ existe sur le modèle Odoo
  mais n'est pas exposé) de `inconnu` (il n'existe pas). Pendant les sondages du
  08/09, `ticket_type_id` et `category_id` apparaissaient à côté de champs bien
  réels, sans que rien ne les distingue.
- Chaque ticket porte un sous-objet `helpdesk` : équipe, produit, fonction du
  demandeur, priorité, état kanban, date de clôture, référence.
- Client Odoo : `searchCount` et `readGroup` (avec `lazy: false` forcé et
  transmission de `context.tz`).

### Modifié

- Les réponses `search_helpdesk` ne sont plus indentées (l'indentation
  représentait 14 % de la charge sur une page de 50 tickets).
- Un seul appel `mail.message` par ticket **et seulement sur demande**, mené par
  lots de 5 en parallèle au lieu d'une boucle séquentielle.

### Sécurité

**`access_token` n'est pas exposé**, bien qu'il existe sur le modèle et que la
liste blanche couvre désormais tout le reste. C'est le jeton du portail Odoo :
combiné à `access_url`, il ouvre le ticket **sans authentification**. Le faire
transiter par un outil MCP déverserait des jetons d'accès dans le contexte d'un
modèle de langage et dans les journaux. Un test vérifie qu'il n'est ni demandé à
Odoo ni présent dans la sortie, même explicitement réclamé.

Les champs par défaut restent volontairement **étroits** (32 champs sur 113) :
ni binaire (`rating_last_image`), ni blob JSON (`properties`,
`duration_tracking`), ni tableau d'identifiants non borné
(`partner_ticket_ids`, `domain_user_ids`…). Tout cela reste demandable via
`fields`, mais n'est plus imposé à qui ne demande rien.

Le connecteur reste **strictement en lecture seule**. Les deux méthodes ajoutées,
`search_count` et `read_group`, comptent et regroupent — elles n'écrivent rien.
`fields_get` est resté volontairement hors périmètre du runtime : l'introspection
du modèle a eu lieu une fois, à la conception, et son résultat est figé dans une
table statique. Un test vérifie qu'un appel `create`/`write`/`unlink` est refusé
**avant tout appel réseau**, sur chacun des modèles autorisés.

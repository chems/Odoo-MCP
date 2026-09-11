# Diagnostic — lot 1 du plan d'amélioration

**Mesuré le 09/09/2026**, en lecture seule, par `scripts/diagnostic-d8.ts` et
`scripts/diff-champs.ts`, sur les **deux** instances :

| | `scolares-test-20260902` | `scolares` (production) |
|---|---|---|
| Ticket le plus récent (toutes équipes) | 02/09 09:37 | **09/09 12:07** |
| Tickets, instance entière | 39 961 | 40 789 |
| Équipe 27, total | 619 | **732** |
| Équipe 27, 30 jours | 602 | 715 |
| Champs sur `helpdesk.ticket` | 112 | **114** |

Instance : **Odoo 18.0 Enterprise** (`server_version: 18.0+e`) dans les deux cas.

---

## 1. D8 — fraîcheur des données : **tranché, ce n'est pas un défaut du connecteur**

La production a été interrogée directement : elle renvoie des tickets **du jour
même**, à quelques minutes près.

| Mesure (production `scolares`) | Résultat |
|---|---|
| Ticket le plus récent, équipe 27 | #42760, `2026-09-09 10:31:48` |
| Ticket d'id le plus élevé, équipe 27 | #42760 — **le même** |
| Ticket le plus récent, toutes équipes | #42765, `2026-09-09 12:07:37` |
| `search_count` équipe 27, par défaut | 732 |
| `search_count` équipe 27, `active_test: false` | **732 — identique** |
| Équipe 27, 7 derniers jours | 106 |

Il n'y a **aucune latence** et **aucun cache** sur le chemin de lecture. Le
connecteur voit la production à la seconde près.

Les quatre pistes que le plan demandait d'écarter le sont :

- **Cache applicatif** : le cache vectoriel (`.cache/embeddings`, checkpoint 15/07/2026)
  ne sert qu'aux modes `semantic`/`hybrid`. Le mode `text`, qui est le défaut, appelle
  Odoo en direct. Écarté.
- **Filtre `active`** : aucun ticket archivé. 619 avec et sans `active_test: false`.
- **Tri** : l'horizon par `create_date` et par `id` désigne le même ticket, donc aucun
  ticket récent n'était relégué en fin de pagination.
- **Droits du compte technique** : uid 17 voit les 20 équipes et 40 789 tickets. Aucun
  domaine implicite détectable.

**La copie de test, elle, s'arrête à son instant de copie** : 02/09/2026 09:37. Une copie
datée ne peut pas contenir de ticket postérieur à sa date, et rien dans la sortie d'un
outil ne le signale.

**Explication retenue pour l'observation du 08/09** : le connecteur interrogeait une
**copie de test**, et non la production. Le `.env` porte les deux configurations, l'une
active et l'autre en commentaire — il suffit qu'une copie dont l'horizon était le 04/09
ait été active ce jour-là. Les chiffres du rapport du 08/09 décrivent l'état d'une copie.

**Conséquence** : ni défaut du connecteur, ni latence Odoo, mais une limite de
configuration invisible depuis la sortie de l'outil. Avant d'interpréter toute volumétrie,
vérifier quelle ligne du `.env` est active.

**Vérité de terrain actualisée** (production, 09/09/2026) : équipe 27 = **732 tickets**
au total, **715** sur 30 jours, **106** sur 7 jours. Le plan initial annonçait 676–699 le
08/09 : l'ordre de grandeur est cohérent, l'écart correspond à la croissance sur un jour
de rentrée.

---

## 2. D2 — tri non maîtrisé : reproduit à l'identique

`search_read` sans `order` (ce que fait le code aujourd'hui), équipe 27 :

```
40855 (26/08) priorité 3     ← bloc prioritaire
39770 (20/08) priorité 3
39743 (20/08) priorité 2
39581 (19/08) priorité 1
39200 (17/08) priorité 1
41919 (02/09) priorité 0     ← puis id décroissant
41917 (02/09) priorité 0
41909 (02/09) priorité 0
```

Le `_order` par défaut de `helpdesk.ticket` est **`priority desc, id desc`**. C'est
exactement la séquence rapportée le 08/09. Diagnostic clos, correctif au lot 2.

---

## 3. D9 (nouveau) — les champs par défaut n'étaient pas portables d'une instance à l'autre

`sale_order_id` et `sale_order_state` figurent dans `ALLOWED_FIELDS['helpdesk.ticket']`.
Ils **existent en production** mais sont **absents de la copie de test** (module Ventes
non installé sur la copie) :

```
[builtins.ValueError] Invalid field 'sale_order_id' on model 'helpdesk.ticket'
```

Comme `DEFAULT_FIELDS` valait `ALLOWED_FIELDS`, **tout appel `search_helpdesk` ne précisant
pas `fields` échouait sur la copie de test** — l'appel entier, pas seulement ces deux
champs. Cela explique au passage pourquoi la campagne du 08/09 utilisait `fields: ["id"]`.

La correction n'est donc pas de retirer ces champs — ce serait perdre de la donnée en
production — mais de **découpler `DEFAULT_FIELDS` de `ALLOWED_FIELDS`** : les champs
dépendants de l'instance restent demandables explicitement, jamais imposés à qui ne
demande rien. Voir `INSTANCE_CONDITIONAL_FIELDS` dans `src/security/whitelist.ts`.

Défaut bloquant, non listé dans le plan initial.

---

## 4. D4 — la prémisse est fausse : `ticket_type_id` n'existe pas

`fields_get` renvoie **112 champs** sur `helpdesk.ticket`. `ticket_type_id` n'en fait pas
partie, et le modèle `helpdesk.ticket.type` n'existe pas non plus :

```
[builtins.ValueError]     Invalid field 'ticket_type_id' on model 'helpdesk.ticket'
[odoo.exceptions.UserError] Object helpdesk.ticket.type doesn't exist
```

Le plan supposait que `ticket_type_id` était « le Type d'Odoo » simplement non exposé. En
Odoo 18 Enterprise, ce champ n'existe pas sur ce modèle. `category_id` non plus.

### Les axes de catégorisation réellement disponibles

Équipe 27, 30 derniers jours, **715 tickets** (production, 09/09/2026) :

**`x_studio_produit`** — champ Studio, type `selection`, libellé « Produit », 13 valeurs.
**C'est le champ de catégorisation métier de Scolares**, et il est **déjà dans la liste
blanche** — simplement jamais exposé en sortie ni proposé comme axe.

| Produit | Tickets | Part |
|---|---|---|
| *(non renseigné)* | 288 | 40,3 % |
| Proeco5 | 241 | 33,7 % |
| Horizon Présences | 183 | 25,6 % |
| Cabanga | 2 | 0,3 % |
| Proeco4 | 1 | 0,1 % |

**`tag_ids`** — many2many vers `helpdesk.tag` (26 étiquettes définies) :

| Étiquette | Tickets |
|---|---|
| *(aucune étiquette)* | 400 |
| Demande Assistance | 301 |
| A développer | 20 |
| Bug / Incident | 1 |
| rappeler jeudi | 1 |

Somme des groupes : **723 pour 715 tickets**. L'écart est réel — des tickets portent
plusieurs étiquettes (ex. `["Demande Assistance", "rappeler jeudi"]`). C'est exactement ce
que l'avertissement « axe multivalué » de `helpdesk_stats` signale.

**`stage_id`** : Solved, Attente utilisateur, Attente 3e partie, New, Canceled,
En traitement.

**`x_studio_fonction`** — selection, « Fonction » du demandeur, 9 valeurs (Direction,
Secrétaire, Enseignant…). Axe secondaire utile.

> **À dire à l'appelant** : quel que soit l'axe, **une large part des tickets de l'équipe
> 27 n'est pas catégorisée** (288/715 sans produit, 400/715 sans étiquette). La
> ventilation demandée est calculable, mais elle laisse 40 à 56 % des tickets hors
> catégorie. C'est une limite de la saisie, pas du connecteur, et elle doit apparaître en
> clair dans la réponse plutôt que d'être découverte après coup — d'où le groupe au
> libellé `null`, qui la mesure exactement.

---

## 5. Comportement de `read_group` en Odoo 18 (valide le lot 4)

- **`lazy: false`** développe bien tous les niveaux. Les lignes multi-axes sont renvoyées
  **à plat**, une par combinaison, chaque axe présent comme clé.
- Le compteur est **`__count`**. Un `__domain` est joint à chaque ligne, et un `__range`
  pour les regroupements de date.
- **many2one** → `[id, "Libellé"]`. **Vide** → `false`. **selection** → la valeur brute.
- **`tag_ids`** : contrairement à ce que supposait le plan, les tickets **sans** étiquette
  **apparaissent bien**, dans un groupe `tag_ids: false` (domaine `not any`). L'avertissement
  à émettre est donc plus étroit que prévu : seule la double-comptabilisation des tickets
  multi-étiquettes reste un risque — et elle est **avérée en production** (723 groupés pour
  715 tickets).
- **`context.tz`** fonctionne : `create_date:day` renvoie des bornes `__range` à
  `22:00:00` UTC, soit minuit à Bruxelles en heure d'été, et des libellés localisés
  (`« 01 sept. 2026 »`).

---

## 5 bis. Couverture des champs `helpdesk.ticket`

Comparaison du relevé `fields_get` de production (114 champs) avec la liste blanche :
**82 champs manquaient**. Ils ont tous été ajoutés, sauf un.

| Décision | Champs | Motif |
|---|---|---|
| **Exposés** (demandables via `fields`) | 113 | Couverture complète du modèle |
| **Jamais exposé** | `access_token` | Jeton d'accès portail — voir ci-dessous |
| **Hors défaut, demandables** | `sale_order_id`, `sale_order_state` | Absents de certaines instances |
| **Hors défaut, demandables** | `rating_last_image`, `properties`, `duration_tracking`, `partner_ticket_ids`, `domain_user_ids`, `message_follower_ids`, `website_message_ids`, `rating_ids`, `sla_status_ids`, `activity_ids` | Binaire, blobs JSON, tableaux d'ids non bornés |

**`access_token` est délibérément exclu.** Mesuré sur un ticket réel, il vaut
`"f74e370f-09a3-4087-9aae-bcf70248a63c"` : c'est le jeton du portail Odoo qui, combiné à
`access_url` (`/my/ticket/42760`), ouvre le ticket **sans authentification**. Le faire
transiter par un outil MCP reviendrait à déverser des jetons d'accès dans le contexte d'un
modèle de langage et dans les journaux. `access_url` seul, lui, est exposé — et sert
désormais à renseigner le champ `url`, qui valait `null` jusqu'ici.

Poids mesuré des champs ajoutés (moyenne sur 10 tickets réels) : tous sous 40 octets, sauf
`partner_ticket_ids` (180 o) et `domain_user_ids` (146 o) — les deux étant justement hors
des champs par défaut.

## 6. D5 — équipe 27

Confirmé : **27 = « Horizon Présences »** (société : ASBL Scolares). 20 équipes au total.

---

## 7. Lot 7 — repli formulaire web : abandonné

371 tickets portent la mention littérale `ticket_type_id` dans leur description, mais les
tickets examinés portent l'étiquette 6 « Demande Assistance », sans rapport avec la valeur
recopiée. Le champ visé n'existant pas en base et deux axes exploitables existant déjà
(`x_studio_produit`, `tag_ids`), ce repli n'a plus d'objet. Abandonné, comme le prévoit le
§9 du plan initial.

---

## Ce qui change dans la suite du plan

1. **Lot 6 re-cadré** : `ticket_type_id` est remplacé par **`x_studio_produit`** (axe
   principal) et **`tag_ids`** (axe secondaire). Aucun champ n'est ajouté à la liste
   blanche — les deux y sont déjà. **Deux champs en sont retirés** : `sale_order_id` et
   `sale_order_state` (D9).
2. **Lot 4** : `helpdesk.ticket.type` disparaît des modèles à exposer. Les axes de
   `helpdesk_stats` deviennent `team_id`, `stage_id`, `user_id`, `partner_id`, `priority`,
   `kanban_state`, `tag_ids`, `x_studio_produit`, `x_studio_fonction`, `create_date:day|week|month`.
3. **Lot 7** : abandonné.
4. **Lot 8** : ajouter l'instance interrogée et la date du ticket le plus récent à la
   réponse, pour rendre visible qu'on lit une copie.

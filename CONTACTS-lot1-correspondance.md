# Service Contacts — lots 0 et 1

Livrable bloquant du `PLAN-service-contacts-lecture.md`. **Aucun code de service
n'a été écrit** : le plan exige que cette table soit validée d'abord.

**Mesuré le 09/09/2026** sur `scolares-test-20260902` (Odoo 18.0 Enterprise,
uid 17), en lecture seule, par `scripts/diagnostic-contacts.ts`,
`diagnostic-contacts-2.ts` et `diff-champs-contacts.ts`.

Volumétrie : **14 268 partenaires** — 2 065 sociétés, 12 203 personnes, 159 archivés.
Le compte technique lit `res.partner` sans restriction apparente.

---

## Lot 0 — la décision du §0 est forcée

Le plan demande de trancher entre **(a)** intégrer les contacts dans
`odoo-readonly` et **(b)** faire évoluer un serveur contacts existant.

**Le serveur supposé exister est introuvable.** Recherche par nom et par contenu
sous `c:\MPC\`, `c:\nodejs\`, `c:\odoo-dev\`, Desktop, Documents, Downloads et
OneDrive : les quatre noms d'outils (`search_contacts`, `get_contact_by_id`,
`search_companies`, `search_individuals`) n'apparaissent **que dans le plan
lui-même**. La seule configuration cliente MCP de la machine
(`claude_desktop_config.json`) ne déclare qu'un serveur Odoo : `odoo-readonly`.

Deux projets touchent à `res.partner` sans être des serveurs MCP :
`c:\nodejs\Odoo-MCP` (monorepo pnpm, **qui écrit** dans Odoo — `create`/`write`)
et `c:\nodejs\odoo-tag` (CLI d'étiquetage, écrit aussi). Ni l'un ni l'autre ne
peut servir de base à un service en lecture seule.

**→ Option (a) retenue**, faute d'alternative actionnable. C'était de toute
façon l'option que le plan privilégiait.

> **Point de sécurité à traiter séparément** : `claude_desktop_config.json`
> contient la clé API Odoo **en clair**, et pointe sur la **production**. Le même
> secret est dans `.env`. À arbitrer hors de ce chantier.

---

## Lot 1 — résultats

### 1. Les seize paires `_1` : le risque bloquant n'existe pas

Le plan y voyait le point le plus dangereux (« l'échec le plus coûteux, parce
qu'il est silencieux et plausible »). **Mesure : les seize variantes `_1` sont
intégralement vides.** Sur 2 065 sociétés, zéro enregistrement renseigné.

| Champ de base | Type | Base remplie | Variante `_1` | Les deux | Verdict |
|---|---|---|---|---|---|
| `x_studio_fase` | char | 1 672 | **0** | 0 | base |
| `x_studio_fase_po` | char | 1 642 | **0** | 0 | base |
| `x_studio_rseau` | selection | 1 689 | **0** | 0 | base |
| `x_studio_niveau` | selection | 1 636 | **0** | 0 | base |
| `x_studio_serveur_net` | char | 1 590 | **0** | 0 | base |
| `x_studio_serveur_cloud` | char | 1 589 | **0** | 0 | base |
| `x_studio_license_proeco` | char | 1 546 | **0** | 0 | base |
| `x_studio_nombre_dlves` | integer | 1 477 | **0** | 0 | base |
| `x_studio_edid` | char | 918 | **0** | 0 | base |
| `x_studio_mise_en_prod_pes` | date | 830 | **0** | 0 | base |
| `x_studio_diocse` | char | 822 | **0** | 0 | base |
| `x_studio_entit` | char | 812 | **0** | 0 | base |
| `x_studio_logiciel_comptable` | char | 733 | **0** | 0 | base |
| `x_studio_module_frais` | boolean | 627 | **0** | 0 | base |
| `x_studio_activation_frais` | date | 566 | **0** | 0 | base |
| `x_studio_nom_du_po` | char | 192 | **0** | 0 | base |

**Aucune divergence à arbitrer, aucun conflit à signaler, aucun `OR` à faire.**
La règle est uniforme : **toujours le champ sans suffixe**. Le lot 1 se referme
sans la complexité que le plan anticipait, et le risque n°1 du §7 est sans objet.

Les variantes `_1` restent **hors liste blanche** : les exposer n'apporterait
rien et rouvrirait exactement l'ambiguïté que le plan veut éliminer.

> Réserve honnête : mesuré sur la copie de test du 02/09. À reconfirmer sur la
> production avant mise en service — c'est une requête, pas un chantier.

### 2. Les deux anomalies du §1.2

- **`x_studio_char_field_P9tBM`** (« New Texte ») : **0 société renseignée**.
  Champ Studio abandonné, confirmé. **Écarté.**
- **`x_studio_fase_index_1`** : **1 672 sociétés renseignées** — exactement le
  même effectif que `x_studio_fase`. Ce n'est donc pas un orphelin inerte mais
  un index parallèle. **Question ouverte** : ses valeurs sont-elles identiques à
  `x_studio_fase` ? Non vérifié. Tant que ce n'est pas tranché, il reste hors
  liste blanche.

### 3. Les numéros FASE — le plan se trompe de danger

Le §1.3 redoutait les zéros de tête et la comparaison entier/chaîne. Mesure sur
les 1 672 sociétés qui portent un FASE :

- **Zéro valeur avec zéro de tête.** `"03003"` ne correspond à rien. La crainte
  du plan est infondée sur ces données.
- **La requête d'exemple fonctionne telle quelle.** `["x_studio_fase","=",3003]`
  (entier) → **1 résultat**, comme `"3003"` (chaîne) : Odoo coercit l'entier vers
  la chaîne pour l'opérateur `=`. Le §1.3 est donc à corriger — la prudence reste
  utile pour `in` et `ilike`, pas pour `=`.
- **En revanche, 76 valeurs ne sont pas numériques** : `5448/3048`, `5437/1230`,
  `5413/142`, `542/542`, et un `B` isolé. Un FASE peut porter **deux numéros
  séparés par `/`**. C'est le vrai piège : un filtre `= "5448"` rate l'école.
- **Longueurs de 1 à 10 caractères** : 938 à 4 chiffres, 393 à 3, 215 à 5,
  54 à 9, 50 à 2, 14 à 8.

**Conséquence pour le service** : normaliser en chaîne, et interroger à la fois
l'égalité exacte **et** l'appartenance à une valeur composite (`ilike` sur les
fragments séparés par `/`). L'expliquer dans la réponse, comme le veut le
principe 4.

### 4. Le FASE n'identifie pas une école de façon unique

Le §3 pose que « un numéro FASE identifie une école aussi sûrement qu'un id ».
**C'est faux** : **1 654 FASE distincts pour 1 672 sociétés**, soit **14 numéros
portés par plusieurs sociétés**.

```
541    #231   Lycée Mater Dei - 1              | #28459 Lycée Mater Dei - 2
524    #4694  L'Ecole Intégrée - Fondamental   | #5987  L'Ecole Intégrée - Secondaire Spécialisé
2060   #4859  Ecole Fondamentale LMS R. Brasseur | #6054 Ecole Secondaire Robert Brasseur
95682  #5019  Petit Collège de Godinne - Ecole Primaire | #34515 (même école, doublon apparent)
2462   #125   Institut Sainte-Marie d'Arlon    | #19523 Marcellin Champagnat ASBL
```

Deux causes distinctes : des implantations fondamental/secondaire qui partagent
légitimement un FASE, et de véritables doublons de fiches. **`get_contact` par
FASE doit donc renvoyer une liste**, jamais un enregistrement unique, et signaler
la multiplicité. Un service qui renverrait « la » fiche en choisirait une au
hasard.

### 5. Correction structurelle : `parent_id` est vide sur les sociétés

Le §3 fait renvoyer par `get_contact` « le P.O. parent ». Mesure : **`parent_id`
est renseigné sur 0 des 2 065 sociétés.**

La hiérarchie réelle est différente :

- **personne → école** : `parent_id` sur les personnes physiques pointe la société ;
- **école → P.O.** : pas de relation, mais deux champs texte,
  `x_studio_fase_po` (80 % rempli) et `x_studio_nom_du_po` (9 %).

Le rattachement au pouvoir organisateur est donc **une jointure textuelle sur le
FASE du P.O.**, pas un `many2one`. À écrire explicitement dans le service, sans
quoi il renverra systématiquement « pas de parent ».

### 6. Résolution ticket → école (pré-mesure du lot 6)

Sur les 1 000 tickets les plus récents :

| | Tickets | Part |
|---|---|---|
| avec `partner_id` | 995 | 100 % |
| dont le partenaire porte un FASE directement | 120 | 12 % |
| dont le partenaire est rattaché à un parent | 779 | 78 % |

La résolution demande donc **de remonter au `parent_id`** dans 78 % des cas : le
`partner_id` d'un ticket est le plus souvent une personne, pas l'école. La
jointure est faisable et couvre ~90 % des tickets, mais elle n'est pas directe —
à dire dans la description de l'outil, comme le demande le lot 6.

### 7. Le relevé `fields-contact.json` ne décrit pas cette instance

Même écart que sur `helpdesk.ticket` : le relevé fourni annonce **254 champs**,
l'instance en expose **192**. **63 champs du relevé n'existent pas ici** — tous
comptables, bancaires, facturation, Peppol, ventes (`invoice_ids`,
`property_account_*`, `peppol_*`, `sale_order_ids`, `trust`, `supplier_rank`…),
plus `citizen_identification` et `form_file`. Les demander ferait échouer
**l'appel entier**, pas seulement ces champs.

Ce sont exactement les catégories que le §5 du plan veut exclure : aucun conflit.
Et surtout : **les 34 champs métier visés au §1.4 sont tous présents.** La liste
blanche proposée est sûre sur les deux instances.

Le fichier d'exemple `query-patterns-samples.json` mentionne une troisième base,
`scolares-test-gedi3`, ce qui explique vraisemblablement l'écart.

---

## Table de correspondance — nom métier → champ Odoo

Taux mesurés sur les **2 065 sociétés** de `scolares-test-20260902`, le 09/09/2026.
Aucune variante `_1` n'est retenue : toutes sont vides.

| Nom métier | Champ Odoo | Type | Remplis | Taux |
|---|---|---|---|---|
| `entiteCommerciale` | `commercial_partner_id` | many2one | 2 065 | 100 % |
| `ville` | `city` | char | 2 043 | 99 % |
| `codePostal` | `zip` | char | 2 024 | 98 % |
| `pays` | `country_id` | many2one | 2 020 | 98 % |
| `etiquettes` | `category_id` | many2many | 1 801 | 87 % |
| `secteur` | `industry_id` | many2one | 1 773 | 86 % |
| `reference` | `ref` | char | 1 727 | 84 % |
| `reseau` | `x_studio_rseau` | selection | 1 689 | 82 % |
| `fase` | `x_studio_fase` | char | 1 672 | 81 % |
| `email` | `email` | char | 1 664 | 81 % |
| `telephone` | `phone` | char | 1 662 | 80 % |
| `fasePo` | `x_studio_fase_po` | char | 1 642 | 80 % |
| `niveau` | `x_studio_niveau` | selection | 1 636 | 79 % |
| `serveurNet` | `x_studio_serveur_net` | char | 1 590 | 77 % |
| `serveurCloud` | `x_studio_serveur_cloud` | char | 1 589 | 77 % |
| `licenceProeco` | `x_studio_license_proeco` | char | 1 546 | 75 % |
| `emailEconomat` | `x_studio_email_economat` | char | 1 488 | 72 % |
| `nombreEleves` | `x_studio_nombre_dlves` | integer | 1 477 | 72 % |
| `appartientPoMultiEcole` | `x_studio_appartient_po_multi_cole` | boolean | 1 069 | 52 % |
| `edid` | `x_studio_edid` | char | 918 | 44 % |
| `diocese` | `x_studio_diocse` | char | 822 | 40 % |
| `entite` | `x_studio_entit` | char | 812 | 39 % |
| `logicielComptable` | `x_studio_logiciel_comptable` | char | 733 | 35 % |
| `licenceComptEco` | `x_studio_licence_compteco` | char | 703 | 34 % |
| `moduleFrais` | `x_studio_module_frais` | boolean | 627 | 30 % |
| `licenceEdt` | `x_studio_licence_edt` | char | 422 | 20 % |
| `moduleSms` | `x_studio_module_sms` | boolean | 373 | 18 % |
| `idCabanga` | `x_studio_id_cabanga` | char | 205 | 10 % |
| `nomPo` | `x_studio_nom_du_po` | char | 192 | 9 % |
| `proeco5v2` | `x_studio_proeco_5_v2` | boolean | **7** | **0 %** |
| `fonction` | `function` | char | **5** | **0 %** |
| `dateActivationV2` | `x_studio_date_dactivation_v2` | date | **1** | **0 %** |
| `parent` | `parent_id` | many2one | **0** | **0 %** |

**Quatre champs quasi vides.** `proeco5v2`, `dateActivationV2` et `function` sont
renseignés sur moins de dix fiches ; `parent_id` sur aucune. Les exposer comme
filtres produirait des réponses vides que le modèle présenterait comme des faits.
Deux options, à trancher avec vous : les exclure, ou les exposer en annonçant
leur taux de remplissage dans `describe_contact_fields`. **Je recommande la
seconde** — c'est précisément le rôle de cet outil, et le principe 4 du plan
(« les erreurs enseignent ») plaide pour dire la vérité plutôt que masquer.

---

## Lexique réel (livrable du lot 3, déjà obtenu)

**`reseau`** — 6 valeurs admises, effectifs mesurés :

| Valeur | Sociétés |
|---|---|
| Libre SeGEC | 1 372 |
| *(non renseigné)* | 376 |
| Communal | 162 |
| Libre Non-SeGec | 80 |
| Provincial | 51 |
| WBE | 19 |
| Autre | 5 |

**`niveau`** — 8 valeurs admises :

| Valeur | Sociétés |
|---|---|
| Fondamental Ordinaire | 876 |
| *(non renseigné)* | 429 |
| Secondaire Ordinaire | 404 |
| Secondaire | 158 |
| Fondamental Spécialisé | 81 |
| Secondaire Spécialisé | 80 |
| Supérieur | 22 |
| Fondamental | 11 |
| Fondamental & Secondaire | 4 |

Noter que `Fondamental` et `Fondamental Ordinaire` coexistent, comme `Secondaire`
et `Secondaire Ordinaire` : la nomenclature elle-même est ambiguë. Le service
doit exposer les huit valeurs telles quelles, sans tenter de les fusionner.

**`logicielComptable`** — champ **texte libre, non normalisé** :

| Valeur | Sociétés |
|---|---|
| *(non renseigné)* | 1 332 |
| ComptEco | 656 |
| BOB | 41 |
| Autre | 24 |
| compteco | **6** |
| Compteco | **3** |
| Winbooks | 2 |
| logiciel | 1 |

Trois graphies de « ComptEco » cohabitent. Un filtre sensible à la casse en
raterait neuf. À traiter par `ilike` et à signaler dans le dictionnaire.

---

## Ce que ces mesures changent dans le plan

| § du plan | Ce qu'il dit | Ce que mesure la donnée |
|---|---|---|
| §0 | Un serveur contacts existe, trancher (a)/(b) | Il n'existe pas → **(a) forcée** |
| §1.2 | 16 paires `_1` ambiguës, risque bloquant | **Les 16 variantes sont vides** → règle uniforme, risque nul |
| §1.2 | `x_studio_fase_index_1` orphelin | **Rempli sur 1 672 sociétés** → à trancher |
| §1.3 | Comparer un FASE à un entier ne marche pas | **Marche pour `=`** ; le vrai piège est les FASE composites `5448/3048` |
| §1.3 | Zéros de tête dans les FASE | **Aucun** dans les données |
| §3 `get_contact` | Un FASE identifie une école | **14 FASE partagés** → renvoyer une liste |
| §3 `get_contact` | Renvoie « le P.O. parent » | **`parent_id` vide sur toutes les sociétés** → le P.O. passe par `x_studio_fase_po` |
| §1.1 | 254 champs | **192** sur cette instance ; 63 du relevé absents |
| Lot 6 | Résolution ticket → école | **12 % direct, 78 % via le parent** de la personne |

---

## Ce sur quoi j'attends votre validation

1. **La table de correspondance ci-dessus** — c'est le livrable bloquant.
2. **Les quatre champs quasi vides** (`proeco5v2`, `dateActivationV2`,
   `function`, `parent`) : exposer avec leur taux, ou exclure ?
3. **`x_studio_fase_index_1`** : je compare ses valeurs à `x_studio_fase` avant
   de décider, ou on l'écarte sans plus d'examen ?
4. **Le §5 « Données personnelles »** demande de vérifier auprès du responsable
   du traitement que l'exposition de courriels nominatifs à un assistant est
   couverte par le registre. **12 203 personnes physiques** sont concernées.
   C'est une question à poser avant la mise en service, pas après — je la
   remonte, je ne peux pas y répondre.

Rien ne sera codé avant votre retour.

# odoo-readonly-mcp

Serveur MCP (Model Context Protocol) local, **strictement en lecture seule**, permettant à un client MCP (Claude Desktop, etc.) d'interroger trois modules Odoo :

- **Connaissance** (modèle `knowledge.article`)
- **Assistance** (modèle `helpdesk.ticket`)
- **Contacts / écoles** (modèle `res.partner`, sociétés uniquement)

Le serveur expose 12 tools (13 noms, `search_helpdesk_messages` étant un alias) :

| Tool | Rôle |
|---|---|
| `search_knowledge` | Recherche dans les articles de Connaissance |
| `search_helpdesk` | Recherche de tickets, filtrée et paginée |
| `search_all` | Recherche croisée Connaissance + Assistance |
| `helpdesk_stats` | **Compte et ventile** les tickets sans les récupérer |
| `list_helpdesk_teams` | Relie un `teamId` à un nom d'équipe |
| `get_helpdesk_ticket_messages` (alias `search_helpdesk_messages`) | Fil de messages d'un ticket |
| `describe_contact_fields` | **Dictionnaire** des champs école : noms, types, valeurs admises, taux de remplissage |
| `search_schools` | Recherche d'établissements par filtres nommés |
| `get_contact` | Fiche école par identifiant **ou par numéro FASE** |
| `list_contact_field_values` | Lexique réel d'un axe, avec effectifs |
| `contact_stats` | Compte et ventile les écoles |
| `resolve_school_from_ticket` | **Jointure** ticket d'Assistance → fiche école |

## Ce que ce serveur fait réellement

Ce n'est **pas** un client REST custom : il appelle l'**API externe standard d'Odoo** en JSON-RPC (`POST {ODOO_BASE_URL}/jsonrpc`, `service: "object"`, `method: "execute_kw"`). L'authentification se fait par les arguments positionnels `execute_kw(db, uid, api_key, model, method, args, kwargs)` — il n'y a pas de header `Authorization` à fournir.

Une whitelist stricte, vérifiée en code (`src/security/whitelist.ts`), n'autorise qu'une **matrice explicite par modèle** — et non un produit cartésien modèles × méthodes, pour qu'ajouter une méthode ne l'ouvre jamais partout à son insu :

| Modèle | Méthodes autorisées | Usage |
|---|---|---|
| `knowledge.article` | `search_read` | `search_knowledge`, `search_all` |
| `helpdesk.ticket` | `search_read`, `search_count`, `read_group` | `search_helpdesk`, `helpdesk_stats`, `search_all` |
| `mail.message` | `search_read` | `get_helpdesk_ticket_messages` |
| `helpdesk.team` | `search_read`, `search_count` | `list_helpdesk_teams` |
| `helpdesk.tag` | `search_read` | Libellés des étiquettes |
| `res.partner` | `search_read`, `search_count`, `read_group` | `search_schools`, `get_contact`, `contact_stats` |
| `res.partner.category` | `search_read` | Libellés des étiquettes de contact |

Aucune autre méthode ORM (`create`, `write`, `unlink`, `read`, `fields_get`...) n'est accessible depuis ces tools, même si votre instance Odoo les autorise par ailleurs. `search_count` et `read_group` sont des méthodes de **lecture** : elles comptent et regroupent, elles n'écrivent rien.

`fields_get` reste volontairement hors périmètre : l'introspection du modèle a eu lieu une fois, à la conception (voir [DIAGNOSTIC-D8.md](DIAGNOSTIC-D8.md)), et son résultat est figé dans une table statique.

### Champs : liste blanche vs champs par défaut

Deux listes distinctes, et c'est délibéré :

- **`ALLOWED_FIELDS`** — ce qu'un appelant **peut** demander via `fields`. Pour `helpdesk.ticket`, c'est **la totalité du modèle** (113 des 114 champs relevés en production), `access_token` excepté.
- **`DEFAULT_FIELDS`** — ce qui est demandé quand l'appelant ne précise rien. Volontairement étroit (32 champs) : sans binaire, sans blob JSON, sans tableau d'identifiants non borné, et sans champ dépendant des modules installés.

Ce découplage corrige un défaut concret : `sale_order_id` existe en production mais pas sur les copies de test, et le demander d'office faisait échouer **l'appel entier** avec `Invalid field 'sale_order_id'`.

## Installation

```bash
npm install
cp .env.example .env
# éditer .env avec vos vraies valeurs (ODOO_BASE_URL, ODOO_DB, ODOO_UID, ODOO_API_KEY)
npm run build
```

## Variables d'environnement

Voir [.env.example](.env.example) pour la liste complète et les valeurs par défaut. Les 4 variables suivantes sont obligatoires (le serveur refuse de démarrer sans elles) :

- `ODOO_BASE_URL` — URL de l'instance Odoo, sans `/jsonrpc`
- `ODOO_DB` — nom de la base de données
- `ODOO_UID` — ID numérique de l'utilisateur API
- `ODOO_API_KEY` — clé API de cet utilisateur (Odoo : Paramètres > Utilisateurs > Clés API)

**Ne jamais committer `.env`** (déjà exclu via `.gitignore`). `ODOO_API_KEY`/`ODOO_UID` ne sont jamais logués en clair (masquage systématique, voir `src/config/env.ts` / `src/utils/logger.ts`).

## Lancement

```bash
npm run dev      # via tsx, sans build préalable
# ou
npm run build && npm start
```

Le transport est `stdio` : le serveur lit/écrit le protocole MCP sur stdin/stdout. Tous les logs applicatifs partent sur **stderr** pour ne jamais corrompre le flux MCP.

## Connexion à un client MCP (ex. Claude Desktop)

Ajouter dans la config MCP du client (ex. `claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "odoo-readonly": {
      "command": "node",
      "args": ["c:/MPC/Odoo/odoo-readonly-mcp/dist/index.js"],
      "env": {
        "ODOO_BASE_URL": "https://mycompany.odoo.com",
        "ODOO_DB": "mycompany_prod",
        "ODOO_UID": "17",
        "ODOO_API_KEY": "votre-cle-api"
      }
    }
  }
}
```

## Les tools

Les trois tools de recherche (`search_knowledge`, `search_helpdesk`, `search_all`) acceptent un paramètre `mode` :

- `"text"` (défaut) — recherche plein texte multi-mots : chaque mot de `query` doit apparaître (AND), dans n'importe quel champ indexé (OR), au lieu de traiter toute la requête comme un seul substring littéral. `relevanceScore`/`relevanceReason` sont calculés (recouvrement de tokens, titre pondéré 2×, jamais un score opaque).
- `"semantic"` — recherche par similarité d'embeddings sur un cache vectoriel local (voir [Recherche sémantique](#recherche-sémantique) ci-dessous). Retrouve des résultats conceptuellement liés sans mot-clé exact commun. Nécessite d'avoir lancé `npm run reindex` au préalable ; sinon retombe sur le mode texte avec une note dans `modeLimitations`.
- `"hybrid"` — fusionne les deux (score pondéré, `HYBRID_LEXICAL_WEIGHT`/`HYBRID_SEMANTIC_WEIGHT`).

### `search_knowledge`
Recherche sur `name`+`body` de `knowledge.article`.
Paramètres : `query` (requis), `mode`, `limit` (1-50, défaut 10), `offset`, `fields`, `parentId`, `isPublished`, `isLocked`.

### `search_helpdesk`
Recherche sur `name`+`description` de `helpdesk.ticket`.

Paramètres : `query` (**facultatif** — un filtre purement structuré suffit), `mode`, `limit`, `offset`, `fields`, `order`, `teamId`, `stageId`, `partnerId`, `userId`, `product`, `createdAfter`, `createdBefore`, `lastDays`, `includeMessages`, `messageLimit`.

- **`order`** — défaut `create_date desc`, validé contre une liste blanche de 10 valeurs (`create_date|write_date|id|priority|close_date` × `asc|desc`). Un départage par `id desc` est ajouté automatiquement : `create_date` n'est pas unique, et sans ce départage la pagination peut dupliquer ou omettre des tickets.
- **Période** — `createdAfter` (incluse) et `createdBefore` (**exclue**), en `YYYY-MM-DD` (minuit UTC) ou ISO 8601 ; ou bien `lastDays`, exclusif des deux autres. Odoo stockant les datetimes sans fuseau, les bornes sont en UTC.
- **`count` vs `total`** — `count` est la taille de la page renvoyée, `total` le nombre de tickets correspondant au filtre (issu de `search_count`). `hasMore` s'en déduit. En mode `semantic`, `total` vaut `null` avec une note dans `modeLimitations`.
- **`includeMessages`** (défaut `false`) — le fil de messages n'est plus joint par défaut ; les clés `history`/`messages` sont alors **absentes** de la sortie. Pour lire un fil, `get_helpdesk_ticket_messages`.
- **`ignoredFieldsDetail`** — pour chaque champ écarté, `non_expose` (le champ existe sur le modèle Odoo mais n'est pas exposé) ou `inconnu` (il n'existe pas).

### `helpdesk_stats`
Compte et ventile les tickets **en un seul appel**, sans les récupérer (`search_count` + `read_group`).

Paramètres : `groupBy` (1 à 3 axes), les mêmes filtres et bornes temporelles que `search_helpdesk`, `limit` (nombre de **groupes**), `timezone` (défaut `Europe/Brussels`).

Axes disponibles : `team_id`, `stage_id`, `user_id`, `partner_id`, `priority`, `kanban_state`, `tag_ids`, `x_studio_produit`, `x_studio_fonction`, `create_date:day|week|month`.

- `total` vient **toujours** de `search_count`, jamais de la somme des groupes ; `sumOfGroups` est fourni à côté pour que tout écart soit visible plutôt que deviné.
- `warnings` signale explicitement les axes multivalués (`tag_ids` : un ticket portant plusieurs étiquettes compte dans plusieurs groupes), la troncature à `limit` groupes, et le fuseau appliqué aux seuls paquets de dates.
- Les regroupements de date suivent `timezone` (une journée belge, pas une journée UTC), tandis que les bornes de la période restent en UTC.

```json
{
  "source": "helpdesk_stats",
  "total": 602, "sumOfGroups": 602,
  "groupBy": ["x_studio_produit"],
  "period": { "from": "2026-08-10 11:41:41", "to": null, "timezone": "Europe/Brussels" },
  "groupCount": 5,
  "groups": [
    { "key": [{ "field": "x_studio_produit", "id": null, "label": "Proeco5" }], "count": 261 },
    { "key": [{ "field": "x_studio_produit", "id": null, "label": null }], "count": 316 }
  ],
  "warnings": []
}
```

### `list_helpdesk_teams`
Liste les équipes (`helpdesk.team`) avec leur identifiant et leur nom — à appeler pour relier un `teamId` à un nom avant toute recherche filtrée. `includeTicketCount` joint le nombre de tickets par équipe via un **unique** `read_group`, jamais un `search_count` par équipe.

### `get_helpdesk_ticket_messages` (alias `search_helpdesk_messages`)
Fil de messages d'un ticket, via `mail.message` filtré sur `[['model','=','helpdesk.ticket'],['res_id','=',ticketId]]`.
Paramètres : `ticketId` (requis), `limit` (1-50), `offset`, `fields`.

### `search_all`
Recherche en parallèle dans les deux modules (`Promise.allSettled`, résultats partiels si une source échoue), puis détecte des relations lexicales entre articles et tickets.
Paramètres : `query` (requis), `mode`, `limit` (par source), `includeRelations` (défaut `true`).

**Exemple de réponse `search_all`** (structure) :
```json
{
  "source": "all",
  "count": 4,
  "errors": [],
  "crossSearchLimitations": ["..."],
  "results": [
    {
      "source": "knowledge",
      "id": 1669,
      "title": "CAMMAT",
      "summary": "...",
      "content": "...",
      "url": "https://.../knowledge/article/1669",
      "status": "published",
      "tags": null,
      "createdAt": "2024-09-10T13:43:30.000Z",
      "updatedAt": null,
      "relevanceScore": null,
      "relatedResults": [
        { "source": "helpdesk", "id": 7006, "title": "...", "relevanceScore": 0.27, "reason": "3 mot(s)-clé(s) commun(s): budget, ecole, facture" }
      ],
      "unavailableFields": ["tags"]
    }
  ]
}
```

## Le module Contacts (écoles)

Conçu pour un consommateur qui est un **modèle de langage**, pas un développeur : il ne doit jamais avoir à deviner un nom de champ ni une valeur admise. Voir [CONTACTS-lot1-correspondance.md](CONTACTS-lot1-correspondance.md) pour les mesures qui fondent ces choix.

**Aucun passe-plat de domaine Odoo** : pas de paramètre `domain` libre, uniquement des filtres nommés et typés. Le vocabulaire est métier (`fase`, `reseau`, `niveau`, `nombreElevesMin`), jamais ORM.

### Les pièges que le service absorbe

- **Le FASE est du texte, pas un nombre.** `fase: 3003` et `fase: "3003"` donnent le même résultat.
- **Le FASE n'est pas une clé unique** : 14 numéros sont portés par plusieurs fiches (implantations fondamental/secondaire, doublons). `get_contact` renvoie donc toujours une **liste** et signale la multiplicité.
- **76 numéros sont composites** (`5448/3048`). Fournir une seule moitié suffit à retrouver la fiche.
- **Le pouvoir organisateur n'est pas relationnel** : `parent_id` est vide sur la totalité des 2 065 sociétés. Le rattachement passe par `fasePo`, un champ texte.
- **`logicielComptable` est du texte libre non normalisé** : « ComptEco », « compteco » et « Compteco » cohabitent. Le filtre est insensible à la casse ; le regroupement, lui, les compte séparément et le signale.
- **Un échec est instructif** : `get_contact` sur un numéro qui n'est pas un FASE d'école mais un FASE de P.O. répond « en revanche 1 école(s) ont ce numéro comme FASE de pouvoir organisateur — utilisez le filtre fasePo ».

### Deux profils de projection

`short` (défaut) — identité, FASE, réseau, niveau, nombre d'élèves, ville. `full` — ajoute équipement, licences, serveurs et coordonnées. **Une clé n'est émise que si le champ a été demandé** : l'appelant distingue « non demandé » (clé absente) de « non renseigné » (clé à `null`, et champ listé dans `champsVides`).

### Jointure avec Assistance

`resolve_school_from_ticket` remonte du ticket au client puis à l'école. Mesuré sur 1 000 tickets : 99,5 % portent un client, mais **seulement 12 % pointent directement une fiche avec un FASE** — dans 78 % des cas le client est une personne dont le rattachement parent est l'école, et l'outil remonte automatiquement. Le champ `voie` (`direct` / `parent` / `introuvable`) dit toujours par quel chemin la réponse a été obtenue.

## Stratégie de rapprochement de `search_all`

Le rapprochement est **purement lexical**, pas sémantique :

1. Normalisation + tokenisation (minuscules, sans accents, mots-outils filtrés) de `title + content` pour chaque article et chaque ticket.
2. Score de similarité = indice de **Jaccard** (recouvrement de tokens) entre les deux ensembles.
3. Bonus (+0.2, capé à 1.0) si une référence numérique commune (`#1234`, séquence ≥ 4 chiffres) est détectée dans les deux textes.
4. Seuil configurable (`CROSS_SEARCH_MIN_SCORE`, défaut 0.15) ; au maximum 3 relations conservées par résultat.
5. Chaque relation porte une `reason` vérifiable (liste des mots-clés communs), pas un score opaque.

Ce rapprochement `search_all` reste purement lexical (pas d'embeddings). Aucun champ de rattachement structurel confirmé (tags, catégorie, produit, client partagé) n'existe entre `knowledge.article` et `helpdesk.ticket` dans les données observées — il se limite donc au contenu textuel.

## Recherche sémantique

Les modes `"semantic"`/`"hybrid"` des 3 tools s'appuient sur un **cache vectoriel local** :

- Embeddings calculés par un **modèle local** ([`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers), ONNX, `EMBEDDING_MODEL_ID` par défaut `Xenova/all-MiniLM-L6-v2`) — aucune clé API, aucun appel réseau externe après le téléchargement initial des poids du modèle.
- Cache persistant sous `EMBEDDING_CACHE_DIR` (défaut `.cache/embeddings/`, jamais committé) : un fichier binaire à stride fixe par modèle (`<model>.vectors.bin`) + un sidecar JSON (`<model>.index.json`, id → slot/write_date/hash + checkpoints).
- **`npm run reindex`** construit/rafraîchit ce cache en paginant via `search_read` (même méthode whitelistée, juste un kwarg `order` en plus) :
  - `npm run reindex` (sans `--full`) : incrémental, ne traite que les enregistrements dont `write_date` a changé depuis le dernier checkpoint.
  - `npm run reindex -- --full` : rescan complet + élagage des ids supprimés côté Odoo (détectés en comparant avec un scan léger de tous les `id` vivants).
  - `npm run reindex -- --model=knowledge` / `--model=helpdesk` : limite à un seul modèle.
- **L'indexation ne tourne jamais dans un appel d'outil MCP en direct** — les tools ne font que lire le cache déjà construit ; si le cache est absent ou périmé (`EMBEDDING_CACHE_STALE_AFTER_MS`), la réponse le signale explicitement dans `modeLimitations` plutôt que de renvoyer des résultats trompeurs en silence.
- En recherche sémantique, `hasMore` est **exact** (nombre de candidats au-dessus de `SEMANTIC_MIN_SCORE`), contrairement à l'heuristique du mode texte.

**Limite connue du corpus `knowledge.article`** : `body` peut contenir du HTML riche (images en base64) ; une page de recherche trop large peut provoquer un `MemoryError` côté Odoo Online lors de la sérialisation JSON — `npm run reindex` utilise donc une pagination volontairement modeste (40 enregistrements/page).

## Sécurité — checklist

- [x] Whitelist stricte `(model, method)` appliquée en deux endroits (`services/*` et `clients/odooClient.ts`, défense en profondeur) ; testée unitairement (`tests/whitelist.test.ts`).
- [x] Aucun paramètre `model`/`method` n'est exposé aux tools MCP — fixés en dur dans chaque service.
- [x] Secrets (`ODOO_DB`, `ODOO_UID`, `ODOO_API_KEY`, `ODOO_BASE_URL`) exclusivement via `process.env`, jamais en dur (sauf placeholders dans `.env.example`).
- [x] Aucun log ni message d'erreur renvoyé au client MCP ne contient la valeur brute de `ODOO_API_KEY` (masquage systématique + test dédié).
- [x] Timeout HTTP configurable (`ODOO_HTTP_TIMEOUT_MS`), appliqué systématiquement.
- [x] Retries limités (`ODOO_HTTP_MAX_RETRIES`) uniquement sur erreurs transitoires réseau/5xx — jamais sur erreurs d'autorisation/validation.
- [x] Validation Zod stricte de tous les paramètres de tous les tools (bornes `limit`/`offset`, longueur `query`).
- [x] Le paramètre `order` finit dans un `ORDER BY` : il est validé contre une **énumération fermée** de 10 valeurs et reconstruit, jamais repris tel quel.
- [x] La liste blanche est une matrice **explicite par modèle** : ajouter une méthode ne l'ouvre pas à tous les modèles.
- [x] Test dédié vérifiant qu'un appel `create`/`write`/`unlink` est refusé **avant tout POST**, sur chacun des modèles autorisés.
- [x] Plafond dur `MCP_MAX_RESULTS_PER_QUERY`, indépendant du `limit` demandé par le client MCP.
- [x] Troncature systématique des champs texte longs (`MCP_MAX_CONTENT_LENGTH`).
- [x] `search_all` ne fait jamais échouer tout l'appel si une seule source échoue.
- [x] `query` utilisateur toujours passé comme valeur de tuple `ilike`, jamais concaténé dans le domain Odoo.
- [x] `.env` réel jamais committé (`.gitignore`), seul `.env.example` versionné.
- [x] Aucune vérification TLS désactivée (client HTTP standard axios, pas de `rejectUnauthorized: false`).

## Limites connues et informations manquantes

Le modèle `helpdesk.ticket` a été introspecté sur l'instance réelle le 09/09/2026 (Odoo 18.0 Enterprise, 112 champs) — voir [DIAGNOSTIC-D8.md](DIAGNOSTIC-D8.md). Les limites ci-dessous sont mesurées, plus supposées.

- **Pas de champ « type » ni « catégorie »** : `helpdesk.ticket` n'a **ni `ticket_type_id` ni `category_id`** sur cette instance. La catégorisation métier passe par **`x_studio_produit`** (champ Studio « Produit », 13 valeurs) et, secondairement, par **`tag_ids`**.
- **Plus de la moitié des tickets ne sont pas catégorisés** : sur l'équipe 27 et 30 jours, 316/602 sans produit et 356/602 sans étiquette. Toute ventilation par catégorie porte donc sur une minorité de tickets — c'est une limite de la saisie, pas du connecteur, et le groupe au libellé `null` la mesure exactement.
- **`tags`** : désormais **résolu en libellés** sur `helpdesk.ticket` (un seul `search_read` sur `helpdesk.tag` par page). Reste `null` sur `knowledge.article`, où le champ est confirmé absent.
- **`updatedAt`** : désormais renseigné sur les deux modèles depuis `write_date`.
- **`url`** : désormais renseigné sur les deux modèles — `article_url`/`website_url` côté Connaissance, `access_url` côté Assistance. `unavailableFields` est vide sur un ticket normal.
- **`access_token` n'est jamais exposé**, seul champ du modèle délibérément hors liste blanche : c'est le jeton du portail, qui ouvrirait le ticket sans authentification.
- **Charge utile** : une page de 50 tickets pèse ~65 Ko avec les descriptions, ~25 Ko sans (`fields` restreints). Le fil de messages, qui dominait auparavant (~380 Ko pour le même appel), ne pèse plus rien tant qu'il n'est pas demandé. Le reste est la structure du résultat, pas le contenu.
- **`hasMore` en mode sémantique** reste exact (candidats au-dessus de `SEMANTIC_MIN_SCORE`), mais `total` y vaut `null` : un décompte porterait sur le cache vectoriel local, pas sur Odoo.
- **Rapprochement `search_all` purement lexical**, pas sémantique — voir section dédiée ci-dessus.
- **Vérifier sur quelle instance on lit.** Une copie de test datée (`…-test-AAAAMMJJ`) s'arrête à son instant de copie ; rien dans la sortie d'un outil ne le signale. C'est ce qui explique l'absence apparente de tickets récents observée le 08/09/2026 (voir DIAGNOSTIC-D8.md §1).
- Le header `Authorization: Bearer` présent dans la collection Postman d'origine n'est **pas** utilisé par cette implémentation (authentification par arguments positionnels `execute_kw`).

## Scripts npm

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript vers `dist/` |
| `npm start` | Lance le serveur compilé (`dist/index.js`) |
| `npm run dev` | Lance le serveur directement via `tsx` (sans build) |
| `npm run reindex` | Construit/rafraîchit le cache d'embeddings (`--full`, `--model=knowledge\|helpdesk`) |
| `npm test` | Exécute les tests Vitest |
| `npm run test:watch` | Tests Vitest en mode watch |
| `npm run lint` | ESLint sur `src/` et `tests/` |
| `npm run format` | Prettier (écrit les fichiers) |
| `npm run typecheck` | `tsc --noEmit` |

# @building/odoo-adapter

Client TypeScript minimal pour Odoo SaaS via JSON-RPC (`/jsonrpc`).

## Variables d'environnement attendues
- `ODOO_URL` : ex. `https://moninstance.odoo.com`
- `ODOO_DB` : nom de la base
- `ODOO_LOGIN` : login (email utilisateur Odoo) *(optionnel si `ODOO_UID` est fourni)*
- `ODOO_API_KEY` : API key liée à l’utilisateur (utilisée comme "password" RPC)

Optionnel:
- `ODOO_UID` : si tu veux éviter l’appel `login` (sinon le client le récupère et le cache en mémoire)

## Usage rapide
```ts
import { createOdooClientFromEnv } from "@building/odoo-adapter";

const odoo = createOdooClientFromEnv();

const found = await odoo.products.nameSearch("plomberie", { limit: 5 });
console.log(found);

const partners = await odoo.partners.searchRead([["name", "ilike", "Dupont"]], { fields: ["name","email"], limit: 10 });
console.log(partners);
```

## Tests (fixtures JSON)

Les tests Vitest sont pilotés par des **fixtures JSON** modifiables facilement (pas besoin de toucher au TypeScript).

- **Fixtures**: `packages/odoo-adapter/fixtures/*.json`
  - `partners.json`: cas `res.partner`
  - `contacts.json`: cas “contacts” (toujours `res.partner` mais `is_company=false`)
  - `products.json`: cas `product.template` (via `product.product` côté adapter)
  - `rules.json`: tests unitaires de conversion `Rule -> Domain` (flat polish)

### Lancer tous les tests

```bash
pnpm --filter @building/odoo-adapter test
```

### Lancer un seul fichier de test

```bash
pnpm --filter @building/odoo-adapter test -- tests/contacts.spec.ts
```

### Ajouter / modifier un cas de test

Édite la fixture JSON correspondante (ex: `fixtures/partners.json`) et ajoute un objet dans `cases`:

- `name`: libellé du test
- `rule`: condition `["field","operator",value]` **ou** objet `{ "and": [...] } | { "or": [...] } | { "not": ... }`
- `fields`: liste des champs (ou `["__all__"]`)
- `limit`: limite Odoo (optionnel)

## Debug JSON-RPC (opt-in)

Par défaut, le client ne log rien. Pour activer le log des payloads JSON-RPC (API key masquée) :

```bash
set ODOO_ADAPTER_DEBUG=1
pnpm --filter @building/odoo-adapter test
```


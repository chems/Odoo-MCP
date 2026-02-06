# @building/odoo-adapter

Client TypeScript minimal pour Odoo SaaS via JSON-RPC (`/jsonrpc`).

## Variables d'environnement attendues
- `ODOO_URL` : ex. `https://moninstance.odoo.com`
- `ODOO_DB` : nom de la base
- `ODOO_LOGIN` : login (email utilisateur Odoo)
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

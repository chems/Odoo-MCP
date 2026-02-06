# building-ai-odoo (POC)

Monorepo TypeScript pour :
- Odoo SaaS **push full transcription** → API `/ingest`
- Queue (BullMQ/Redis) → Worker orchestrateur (OpenAI Responses API)
- MCP Odoo (clients, produits, devis, lignes, attachments)
- Rapport 12 sections (HTML par défaut)

## Démarrage rapide (local)
1) Copier `.env.example` → `.env` et remplir
2) `pnpm i`
3) Lancer Redis (local) ou configurer `REDIS_URL`
4) `pnpm dev`

> Déploiement Railway : déployer `apps/api` en service web et `apps/worker` en service worker.

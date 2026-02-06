# Architecture (POC Railway)

- apps/api : /ingest (Odoo push transcription) -> enqueue BullMQ
- apps/worker : pipeline (OpenAI Responses API) + actions Odoo (via packages/mcp-odoo)
- packages/prompts : prompts versionnés + schemas de sortie
- packages/openai : wrapper Responses API
- packages/odoo-adapter : JSON-RPC Odoo SaaS
- packages/report : rendu HTML 12 sections

A compléter : JSON canonique final + stratégie upsert lignes devis.

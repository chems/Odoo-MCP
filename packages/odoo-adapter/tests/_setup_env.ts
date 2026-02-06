import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/odoo-adapter/tests -> repo root .env
const envPath = resolve(__dirname, "../../../.env");
const result = config({ path: envPath });

if (result.error) {
  // eslint-disable-next-line no-console
  console.warn(`[test] Failed to load .env from ${envPath}:`, result.error);
} else {
  // eslint-disable-next-line no-console
  console.log(`[test] Loaded .env from ${envPath}`);
}


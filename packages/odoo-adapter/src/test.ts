#!/usr/bin/env node
/**
 * Script de test simple pour odoo-adapter
 * Usage: pnpm --filter @building/odoo-adapter test
 * 
 * Nécessite les variables d'environnement Odoo configurées dans .env
 */

import { createOdooClientFromEnv } from "./client.js";
import { readOdooCredentialsFromEnv } from "./config.js";

async function testOdooAdapter() {
  console.log("🧪 Test de odoo-adapter\n");

  // Test 1: Lecture des credentials depuis l'environnement
  console.log("1️⃣ Test de lecture des credentials...");
  try {
    const creds = readOdooCredentialsFromEnv();
    console.log("✅ Credentials chargés:");
    console.log(`   - URL: ${creds.url}`);
    console.log(`   - DB: ${creds.db}`);
    console.log(`   - Login: ${creds.login}`);
    console.log(`   - API Key: ${creds.apiKey ? "***" : "non défini"}`);
    console.log(`   - UID: ${creds.uid ?? "non défini"}\n`);
  } catch (error) {
    console.error("❌ Erreur lors de la lecture des credentials:", error);
    process.exit(1);
  }

  // Test 2: Création du client
  console.log("2️⃣ Test de création du client...");
  try {
    const client = createOdooClientFromEnv();
    console.log("✅ Client créé avec succès\n");
  } catch (error) {
    console.error("❌ Erreur lors de la création du client:", error);
    process.exit(1);
  }

  // Test 3: Connexion à Odoo (login) - seulement si UID n'est pas fourni
  console.log("3️⃣ Test de connexion à Odoo...");
  try {
    const creds = readOdooCredentialsFromEnv();
    if (creds.uid) {
      console.log(`✅ UID déjà fourni (${creds.uid}), pas besoin de login\n`);
    } else {
      const client = createOdooClientFromEnv();
      const uid = await client.rpc.login();
      console.log(`✅ Connexion réussie! UID: ${uid}\n`);
    }
  } catch (error) {
    console.error("❌ Erreur lors de la connexion:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }

  // Test 4: Recherche de partenaires (test basique)
  console.log("4️⃣ Test de recherche de partenaires...");
  try {
    const client = createOdooClientFromEnv();
    const partners = await client.partners.nameSearch("", { limit: 5 });
    console.log(`✅ Recherche réussie! ${partners.length} partenaire(s) trouvé(s)`);
    if (partners.length > 0) {
      console.log("   Exemples:");
      partners.slice(0, 3).forEach((p, i) => {
        console.log(`   ${i + 1}. [${p.id}] ${p.name}`);
      });
    }
    console.log();
  } catch (error) {
    console.error("❌ Erreur lors de la recherche:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }

  // Test 5: Recherche de produits (test basique)
  console.log("5️⃣ Test de recherche de produits...");
  try {
    const client = createOdooClientFromEnv();
    const products = await client.products.nameSearch("", { limit: 5 });
    console.log(`✅ Recherche réussie! ${products.length} produit(s) trouvé(s)`);
    if (products.length > 0) {
      console.log("   Exemples:");
      products.slice(0, 3).forEach((p, i) => {
        console.log(`   ${i + 1}. [${p.id}] ${p.name}`);
      });
    }
    console.log();
  } catch (error) {
    console.error("❌ Erreur lors de la recherche:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }

  console.log("🎉 Tous les tests sont passés avec succès!");
}

// Exécution du test
testOdooAdapter().catch((error) => {
  console.error("💥 Erreur fatale:", error);
  process.exit(1);
});

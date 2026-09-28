// Migration : type d'événement (sortie/atelier) + table parametres pour le
// référentiel de comptage. Idempotent et re-jouable :
//   node --env-file=.env api/scripts/migrate-type-comptage.js
//
// Ne touche à AUCUNE donnée existante :
//   - events.type : colonne ajoutée, tous les événements passés valent
//     'sortie' (défaut) — le bureau retype les ateliers depuis l'édition ;
//   - parametres : créée si absente (clé du portail sur la prod existante),
//     la clé `comptage_depuis` n'est PAS posée ici : tant qu'elle est absente,
//     tout l'historique compte, comportement inchangé avant/après migration.

import mysql from "mysql2/promise";

const pool = await mysql.createPool({
  host: process.env.DB_MYSQL_HOST,
  user: process.env.DB_MYSQL_USER,
  database: process.env.DB_MYSQL_DATABASE,
  password: process.env.DB_MYSQL_PASSWORD,
});

async function columnExists(table, column) {
  const [rows] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return rows.length > 0;
}

// 1. Table parametres (si l'env n'a jamais eu la clé du portail).
await pool.query(`CREATE TABLE IF NOT EXISTS parametres (
  cle VARCHAR(64) NOT NULL PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_at DATETIME NOT NULL
)`);

// 2. Colonne events.type.
if (await columnExists("events", "type")) {
  console.log("[migrate] events.type : déjà présente, rien à faire.");
} else {
  await pool.query(
    "ALTER TABLE events ADD COLUMN type VARCHAR(16) NOT NULL DEFAULT 'sortie'"
  );
  console.log("[migrate] events.type : colonne ajoutée (défaut 'sortie').");
}

// Rapport final.
const [[{ ev }]] = await pool.query("SELECT COUNT(*) ev FROM events");
const [[{ res: resCount }]] = await pool.query("SELECT COUNT(*) res FROM resultats");
const [[{ par }]] = await pool.query("SELECT COUNT(*) par FROM parametres");
const [[{ comp }]] = await pool.query(
  "SELECT COUNT(*) comp FROM parametres WHERE cle = 'comptage_depuis'"
);
console.log(`[migrate] état : ${ev} événements, ${resCount} résultats, ${par} paramètres, référentiel de comptage ${comp ? "posé" : "absent (tout l'historique compte)"}.`);
await pool.end();

// Migration : colonne paps.uid (garde-fou une-personne-par-événement).
// Idempotent et re-jouable :
//   node api/scripts/migrate-paps-uid.js   (depuis /home/rezal/equipaps)
// Colonne additive : les rangées existantes restent NULL (inscriptions
// historiques), aucune donnée ne bouge.

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = await mysql.createPool({
  host: process.env.DB_MYSQL_HOST,
  user: process.env.DB_MYSQL_USER,
  database: process.env.DB_MYSQL_DATABASE,
  password: process.env.DB_MYSQL_PASSWORD,
});

const [cols] = await pool.query(
  "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'paps' AND COLUMN_NAME = 'uid'"
);
if (cols.length > 0) {
  console.log("[migrate] paps.uid : déjà présente, rien à faire.");
} else {
  await pool.query("ALTER TABLE paps ADD COLUMN uid VARCHAR(16) NULL AFTER pxx");
  console.log("[migrate] paps.uid : colonne ajoutée.");
}
const [[{ c }]] = await pool.query("SELECT COUNT(*) c FROM paps");
console.log(`[migrate] ${c} inscriptions (uid NULL = historique, non concernées par le garde-fou).`);
await pool.end();

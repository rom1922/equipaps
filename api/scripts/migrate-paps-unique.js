// Migration : dédoublonnage paps + index UNIQUE (eid, pxx).
// Idempotent et re-jouable :
//   node api/scripts/migrate-paps-unique.js   (depuis /home/rezal/equipaps)
//
// Les doublons venaient de la course check-then-insert d'avant l'index (double-
// clic, deux onglets) — la lecture dédoublonnait déjà, le tirage est donc
// toujours juste ; on nettoie la base puis on verrouille avec l'index UNIQUE.
// On garde la PLUS ANCIENNE inscription de chaque groupe (id minimal).

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = await mysql.createPool({
  host: process.env.DB_MYSQL_HOST,
  user: process.env.DB_MYSQL_USER,
  database: process.env.DB_MYSQL_DATABASE,
  password: process.env.DB_MYSQL_PASSWORD,
});

// 1. Dédoublonnage (garde l'id minimal de chaque (eid, pxx)).
const [res] = await pool.query(
  `DELETE p1 FROM paps p1
   JOIN paps p2 ON p1.eid = p2.eid AND p1.pxx = p2.pxx AND p1.id > p2.id`
);
console.log(`[migrate] doublons paps supprimés : ${res.affectedRows}`);

// 2. Index unique, gardé (ne recrée pas s'il existe).
const [idx] = await pool.query(
  `SELECT 1 FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'paps' AND INDEX_NAME = 'uniq_paps_eid_pxx'`
);
if (idx.length > 0) {
  console.log("[migrate] index uniq_paps_eid_pxx : déjà présent.");
} else {
  await pool.query("ALTER TABLE paps ADD UNIQUE INDEX uniq_paps_eid_pxx (eid, pxx)");
  console.log("[migrate] index uniq_paps_eid_pxx : créé (eid, pxx).");
}

const [[{ c }]] = await pool.query("SELECT COUNT(*) c FROM paps");
const [[{ d }]] = await pool.query(
  "SELECT COUNT(*) d FROM (SELECT eid, pxx FROM paps GROUP BY eid, pxx HAVING COUNT(*) > 1) x"
);
console.log(`[migrate] ${c} inscriptions, ${d} groupe(s) encore en double (doit être 0).`);
await pool.end();

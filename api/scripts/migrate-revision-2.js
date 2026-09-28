// Migration « révision adverse 2026-09-28 » :
//   - paps.date / hpaps.date en DATETIME(3) : en rush, départager à la
//     milliseconde près (O3) ;
//   - index UNIQUE resultats(eid, pxx) : le gel ne duplique jamais un gagnant
//     (filet du regeler transactionnel, R2-K1) ;
//   - index UNIQUE paps(eid, uid) : la garde une-personne-par-session tient
//     sous rafale (R2-K3) — les uid NULL (historique, ajout bureau) restent
//     exempts (MySQL accepte plusieurs NULL dans un index unique).
// Idempotent et re-jouable :
//   node api/scripts/migrate-revision-2.js   (depuis /home/rezal/equipaps)

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = await mysql.createPool({
  host: process.env.DB_MYSQL_HOST,
  user: process.env.DB_MYSQL_USER,
  database: process.env.DB_MYSQL_DATABASE,
  password: process.env.DB_MYSQL_PASSWORD,
});

async function columnType(table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0]?.COLUMN_TYPE || null;
}

async function indexExists(table, name) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

// 1. Précision milliseconde des inscriptions.
for (const table of ["paps", "hpaps"]) {
  const t = await columnType(table, "date");
  if (t === "datetime(3)") {
    console.log(`[migrate] ${table}.date : déjà en datetime(3).`);
  } else {
    await pool.query(`ALTER TABLE ${table} MODIFY date DATETIME(3) NOT NULL`);
    console.log(`[migrate] ${table}.date : ${t} -> datetime(3).`);
  }
}

// 2. Filet du gel : dédoublonnage défensif puis index unique.
const [res] = await pool.query(
  `DELETE r1 FROM resultats r1
   JOIN resultats r2 ON r1.eid = r2.eid AND r1.pxx = r2.pxx AND r1.id > r2.id`
);
console.log(`[migrate] doublons resultats supprimés : ${res.affectedRows}`);
if (await indexExists("resultats", "uniq_resultats_eid_pxx")) {
  console.log("[migrate] index uniq_resultats_eid_pxx : déjà présent.");
} else {
  await pool.query("ALTER TABLE resultats ADD UNIQUE INDEX uniq_resultats_eid_pxx (eid, pxx)");
  console.log("[migrate] index uniq_resultats_eid_pxx : créé.");
}

// 3. Garde une-personne-par-session, tenue par la base.
if (await indexExists("paps", "uniq_paps_eid_uid")) {
  console.log("[migrate] index uniq_paps_eid_uid : déjà présent.");
} else {
  await pool.query("ALTER TABLE paps ADD UNIQUE INDEX uniq_paps_eid_uid (eid, uid)");
  console.log("[migrate] index uniq_paps_eid_uid : créé.");
}

const [[{ d }]] = await pool.query(
  "SELECT COUNT(*) d FROM (SELECT eid, pxx FROM resultats GROUP BY eid, pxx HAVING COUNT(*) > 1) x"
);
console.log(`[migrate] groupes resultats encore en double : ${d} (doit être 0).`);
await pool.end();

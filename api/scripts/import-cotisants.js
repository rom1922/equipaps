// Import des cotisants BDA depuis l'export HelloAsso -> roster.cotisant.
//
// Wrapper CLI mince sur api/lib/cotisants.js : la MÊME logique sert ici et la
// route d'import de l'interface admin (un seul moteur, zéro dérive). Filtre
// HelloAsso : Statut in {Validé, Hors-ligne} ET Tarif contient « Cotisation
// BDA ». Matching contre le roster : email, nom+prénom, nom+initiale, patronyme
// composé. Les non-résolus deviennent des rangées persistantes non cherchables
// (source_id='helloasso'), à rattacher depuis l'espace bureau.
//
//   node --env-file=<env> api/scripts/import-cotisants.js            (applique)
//   node --env-file=<env> api/scripts/import-cotisants.js --dry      (rapport, sans écriture)
//   COTISANTS_CSV (défaut ./data/cotisants.csv)
// <env> = le fichier d'environnement du déploiement (cf. script start:api).

import fs from "fs";
import {
  loadCotisantsFromText, reconcile, buildPhantomRows, applyReconciliation,
} from "../lib/cotisants.js";

const DRY = process.argv.includes("--dry");
const CSV = process.env.COTISANTS_CSV || "./data/cotisants.csv";

async function main() {
  const cotisants = loadCotisantsFromText(fs.readFileSync(CSV, "utf-8"));
  const mysql = (await import("mysql2/promise")).default;
  const pool = await mysql.createPool({
    host: process.env.DB_MYSQL_HOST, user: process.env.DB_MYSQL_USER,
    database: process.env.DB_MYSQL_DATABASE, password: process.env.DB_MYSQL_PASSWORD,
  });
  const [roster] = await pool.query("SELECT pxx, email, prenom, nom, search_key FROM roster");
  const report = reconcile(cotisants, roster);

  console.log(`[import-cotisants] ${cotisants.length} cotisants BDA dans le CSV`);
  console.log(`[import-cotisants] appariés: ${report.matchedCount} (par ${JSON.stringify(report.byHow)})`);
  console.log(`[import-cotisants] non résolus (${report.unresolved.length}) :`);
  report.unresolved.forEach(u => console.log(`   - ${u.prenom} ${u.nom} <${u.email}> [${u.how}]`));

  if (DRY) { console.log("[import-cotisants] --dry : aucune écriture."); await pool.end(); return; }

  const phantomRows = buildPhantomRows(report.unresolved, roster.map(r => r.pxx));
  const conn = await pool.getConnection();
  let c;
  try {
    await conn.beginTransaction();
    c = await applyReconciliation(conn, report, phantomRows);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    conn.release();
    await pool.end();
    throw e;
  }
  conn.release();
  console.log(`[import-cotisants] appliqué : ${c} cotisants marqués dans le roster (dont ${phantomRows.length} entrées à rattacher).`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

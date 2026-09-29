// Sauvegarde de la base equipaps (mysqldump gzippé vers /home/rezal/backups).
// Charge l'environnement du service via dotenv (jamais de secret en ligne de
// commande, jamais lu par l'agent) et passe le mot de passe à mysqldump par
// l'environnement (MYSQL_PWD). Usage : depuis /home/rezal/equipaps :
//   node api/scripts/backup-db.mjs
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import fs from "node:fs";

const db = process.env.DB_MYSQL_DATABASE;
if (!db) {
  console.error("DB_MYSQL_DATABASE absent : run depuis /home/rezal/equipaps");
  process.exit(1);
}
const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
const dest = `/home/rezal/backups/equipaps-db-${ts}.sql.gz`;
const dump = spawnSync("mysqldump", [
  "--single-transaction", "-h", process.env.DB_MYSQL_HOST || "localhost",
  "-u", process.env.DB_MYSQL_USER || "root", db,
], {
  env: { ...process.env, MYSQL_PWD: process.env.DB_MYSQL_PASSWORD },
  encoding: "buffer", maxBuffer: 256 * 1024 * 1024,
});
if (dump.status !== 0 || !dump.stdout || dump.stdout.length < 512) {
  console.error("mysqldump a échoué ou rendu un contenu vide (code", dump.status, ")");
  process.exit(1);
}
fs.writeFileSync(dest, gzipSync(dump.stdout));
console.log("backup OK:", dest, fs.statSync(dest).size, "octets");

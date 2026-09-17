// Sync lecture-seule : annuaire Pain de Mine (mineurs.json) -> table `roster`.
//
// Contrat : PDM reste le mainteneur de l'annuaire ; equipaps n'écrit JAMAIS
// vers PDM, il ne fait qu'ingérer une copie. La table `roster` remplace
// users.txt. L'identité reste le login portail `pxx` (varchar(10)), la même que
// paps/hpaps/resultats/users : les logins existants (users.txt) sont préservés
// verbatim pour ne pas détacher l'historique du tirage ; les nouveaux élèves
// (dont la promo 26) reçoivent un pxx dérivé unique.
//
// Idempotent et re-jouable :
//   node --env-file=.env api/scripts/sync-roster.js          (upsert en base)
//   node api/scripts/sync-roster.js --dry                    (construit + compte, sans DB)
// Chemins (env, avec défauts) :
//   MINEURS_JSON  (défaut ./data/mineurs.json)   USERS_TXT (défaut ./api/users.txt, optionnel)
//
// Le pont cotisants : au premier passage, users.txt (marqueur *) sème
// roster.cotisant ; les passages suivants PRÉSERVENT cotisant (il viendra de
// l'import HelloAsso, jalon 6). users.txt peut disparaître après le 1er sync.

import fs from "fs";
import { normLogin, normSearch } from "../lib/normalize.js";

const DRY = process.argv.includes("--dry");
const MINEURS = process.env.MINEURS_JSON || "./data/mineurs.json";
const USERS = process.env.USERS_TXT || "./api/users.txt";

function loadStudents(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  const out = [];
  for (const [bucket, val] of Object.entries(raw)) {
    const promo = String(val.promo ?? bucket.replace(/^promo_/, ""));
    for (const e of (val.etudiants || [])) {
      const nnom = normLogin(e.nom);
      if (!nnom) continue;                                   // sans patronyme utile
      if (/faux|profil/i.test(`${e.nom} ${e.prenom}`)) continue;  // profils factices du scrape
      out.push({
        id: String(e.id), prenom: e.prenom || "", nom: e.nom || "",
        email: e.email || null, promo, photo_url: e.photo_url || null,
        nnom, nprenom: normLogin(e.prenom),
      });
    }
  }
  return out;
}

function loadUsers(path) {
  if (!fs.existsSync(path)) return [];
  const seen = new Set(); const out = [];
  for (const line of fs.readFileSync(path, "utf-8").split("\n").map(l => l.trim()).filter(Boolean)) {
    const pxx = line.replace("*", "");
    if (seen.has(pxx)) continue;
    seen.add(pxx);
    out.push({ pxx, cotisant: line.endsWith("*") });
  }
  return out;
}

// Matcher priorisé : rend l'id mineurs unique pour un pxx existant, ou null.
function makeMatcher(students) {
  const byPromo = {};
  for (const s of students) (byPromo[s.promo] ||= []).push(s);
  return function matchPxx(pxx) {
    const promo = pxx.slice(0, 2), stem = pxx.slice(2);
    const tiers = [[], [], []]; // 0 exact/trunc8, 1 homonyme initiale, 2 préfixe
    for (const s of (byPromo[promo] || [])) {
      const n = s.nnom;
      if (n === stem || n.slice(0, 8) === stem) tiers[0].push(s);
      else if (stem.length >= 4 && s.nprenom && (n.slice(0, stem.length - 1) + s.nprenom[0]) === stem) tiers[1].push(s);
      else if (stem.length >= 3 && n.startsWith(stem)) tiers[2].push(s);
    }
    for (const t of tiers) {
      const ids = [...new Set(t.map(x => x.id))];
      if (ids.length === 1) return ids[0];
      if (ids.length > 1) return null;                       // ambigu -> laissé legacy
    }
    return null;
  };
}

// Construit la Map<pxx, row>. Toute la logique de parité vit ici.
function buildRoster(students, users) {
  const usedPxx = new Set(users.map(u => u.pxx));
  const cotisantByPxx = new Map(users.map(u => [u.pxx, u.cotisant]));

  // 1) rangées legacy : chaque pxx existant est conservé (historique + cotisant)
  const rows = new Map();
  for (const u of users) {
    rows.set(u.pxx, {
      pxx: u.pxx, prenom: null, nom: null, email: null, promo: /^\d\d/.test(u.pxx) ? u.pxx.slice(0, 2) : null,
      photo_url: null, search_key: null, cotisant: u.cotisant, source_id: null,
    });
  }

  // 2) attache : pxx existant -> élève mineurs (parité de l'historique)
  const matchPxx = makeMatcher(students);
  const pxxOfStudent = new Map();
  let matched = 0;
  for (const u of users) {
    if (u.pxx.startsWith("xx")) continue;
    const id = matchPxx(u.pxx);
    if (id && !pxxOfStudent.has(id)) { pxxOfStudent.set(id, u.pxx); matched++; }
  }

  // 3) dérive un pxx neuf, unique, pour les élèves non déjà attachés
  function derive(s) {
    const p = s.promo;
    const base = (p + s.nnom).slice(0, 10);
    if (!usedPxx.has(base)) { usedPxx.add(base); return base; }
    const init = s.nprenom[0] || "x";
    for (let n = 0; n <= 50; n++) {
      const suffix = init + (n === 0 ? "" : String(n));
      const keep = Math.max(0, 10 - p.length - suffix.length);
      const cand = (p + s.nnom.slice(0, keep) + suffix).slice(0, 10);
      if (!usedPxx.has(cand)) { usedPxx.add(cand); return cand; }
    }
    const fb = (p.slice(0, 2) + s.id).slice(0, 10);          // filet : id unique
    let c = fb, k = 0;
    while (usedPxx.has(c)) c = (p.slice(0, 1) + s.id + (k++)).slice(0, 10);
    usedPxx.add(c); return c;
  }

  // 4) rangées élèves (nommées) : enrichit un pxx existant ou en crée un neuf
  let named = 0, fresh = 0;
  for (const s of students) {
    const pxx = pxxOfStudent.get(s.id) || derive(s);
    const wasLegacy = rows.has(pxx);
    rows.set(pxx, {
      pxx, prenom: s.prenom, nom: s.nom, email: s.email, promo: s.promo,
      photo_url: s.photo_url, search_key: normSearch(`${s.prenom} ${s.nom}`),
      cotisant: cotisantByPxx.get(pxx) || false, source_id: s.id,
    });
    if (wasLegacy) named++; else fresh++;
  }

  return { rows, stats: { legacy: users.length, matched, named, fresh, total: rows.size } };
}

async function main() {
  const students = loadStudents(MINEURS);
  const users = loadUsers(USERS);
  const { rows, stats } = buildRoster(students, users);

  console.log(`[sync-roster] mineurs=${students.length} users.txt=${users.length}`);
  console.log(`[sync-roster] rangées: ${stats.total} (nommées-revenants ${stats.named}, neuves ${stats.fresh}, legacy-sans-nom ${stats.total - stats.named - stats.fresh})`);
  console.log(`[sync-roster] parité: ${users.length}/${users.length} pxx existants conservés`);

  if (DRY) { console.log("[sync-roster] --dry : aucune écriture DB."); return; }

  const mysql = (await import("mysql2/promise")).default;
  const pool = await mysql.createPool({
    host: process.env.DB_MYSQL_HOST, user: process.env.DB_MYSQL_USER,
    database: process.env.DB_MYSQL_DATABASE, password: process.env.DB_MYSQL_PASSWORD,
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS roster (
    pxx VARCHAR(10) NOT NULL PRIMARY KEY,
    prenom VARCHAR(128) NULL, nom VARCHAR(128) NULL, email VARCHAR(255) NULL,
    promo VARCHAR(8) NULL, photo_url VARCHAR(512) NULL, search_key VARCHAR(255) NULL,
    cotisant TINYINT(1) NOT NULL DEFAULT 0, source_id VARCHAR(16) NULL, synced_at DATETIME NULL,
    INDEX idx_roster_search (search_key)
  )`);

  const now = new Date();
  const list = [...rows.values()];
  // Upsert par lots. ON DUPLICATE ne touche PAS cotisant (préservé : il vient
  // du pont users.txt puis de HelloAsso), ni source_id/nom si la nouvelle est nulle.
  const CHUNK = 500;
  for (let i = 0; i < list.length; i += CHUNK) {
    const batch = list.slice(i, i + CHUNK);
    const values = batch.map(r => [r.pxx, r.prenom, r.nom, r.email, r.promo, r.photo_url,
      r.search_key, r.cotisant ? 1 : 0, r.source_id, now]);
    await pool.query(
      `INSERT INTO roster (pxx, prenom, nom, email, promo, photo_url, search_key, cotisant, source_id, synced_at)
       VALUES ? ON DUPLICATE KEY UPDATE
         prenom=VALUES(prenom), nom=VALUES(nom), email=VALUES(email), promo=VALUES(promo),
         photo_url=VALUES(photo_url), search_key=VALUES(search_key),
         source_id=COALESCE(VALUES(source_id), source_id), synced_at=VALUES(synced_at)`,
      [values]
    );
  }
  const [[{ c }]] = await pool.query("SELECT COUNT(*) c FROM roster");
  const [[{ nc }]] = await pool.query("SELECT COUNT(*) nc FROM roster WHERE search_key IS NOT NULL");
  const [[{ cc }]] = await pool.query("SELECT COUNT(*) cc FROM roster WHERE cotisant=1");
  console.log(`[sync-roster] roster en base: ${c} rangées, ${nc} recherchables, ${cc} cotisants.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

// Import des cotisants BDA depuis l'export HelloAsso -> roster.cotisant.
//
// Remplace le pont provisoire (marqueurs * de users.txt) par la vraie liste des
// cotisants. Filtre HelloAsso : Statut in {Validé, Hors-ligne} ET Tarif contient
// "Cotisation BDA" (exclut « salle ins' seule », « Anciens », « mi année »).
// Matching contre le roster : email d'abord, puis nom+prénom, puis nom + initiale
// du prénom (l'annuaire PDM tronque parfois le prénom). Remet cotisant=0 partout
// puis =1 sur les appariés ; rapporte les non-résolus (à réconcilier à la main).
//
//   node --env-file=.env api/scripts/import-cotisants.js            (applique)
//   node --env-file=.env api/scripts/import-cotisants.js --dry      (rapport, sans écriture)
//   COTISANTS_CSV (défaut ./data/cotisants.csv)

import fs from "fs";
import { normLogin } from "../lib/normalize.js";

const DRY = process.argv.includes("--dry");
const CSV = process.env.COTISANTS_CSV || "./data/cotisants.csv";

// Parse CSV « ; » avec champs éventuellement entre guillemets.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ";") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadCotisants(path) {
  const raw = fs.readFileSync(path, "utf-8").replace(/^﻿/, "");
  const rows = parseCsv(raw);
  const head = rows[0].map(h => h.trim());
  const idx = (name) => head.findIndex(h => h.toLowerCase().startsWith(name.toLowerCase()));
  const iStatut = idx("statut"), iNom = idx("nom adhérent"), iPrenom = idx("prénom adhérent"),
        iEmail = idx("email payeur"), iTarif = idx("tarif");
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length <= iTarif) continue;
    const statut = (row[iStatut] || "").trim();
    const tarif = (row[iTarif] || "").trim();
    const isCotisant = (statut === "Validé" || /hors/i.test(statut)) && /Cotisation BDA/i.test(tarif);
    if (!isCotisant) continue;
    out.push({
      nom: (row[iNom] || "").trim(), prenom: (row[iPrenom] || "").trim(),
      email: (row[iEmail] || "").trim().toLowerCase(), tarif,
    });
  }
  return out;
}

// Apparie un cotisant HelloAsso à UN pxx du roster (ou null si 0/ambigu).
function makeMatcher(roster) {
  const byEmail = new Map();
  const byName = new Map();      // "nnom|nprenom" -> [pxx]
  const byNomInit = new Map();   // "nnom|initiale" -> [pxx]
  for (const r of roster) {
    if (r.email) byEmail.set(r.email.toLowerCase(), r.pxx);
    const nn = normLogin(r.nom), np = normLogin(r.prenom);
    if (nn && np) {
      (byName.get(`${nn}|${np}`) || byName.set(`${nn}|${np}`, []).get(`${nn}|${np}`)).push(r.pxx);
      const k = `${nn}|${np[0]}`;
      (byNomInit.get(k) || byNomInit.set(k, []).get(k)).push(r.pxx);
    }
  }
  return function match(c) {
    if (c.email && byEmail.has(c.email)) return { pxx: byEmail.get(c.email), how: "email" };
    const nn = normLogin(c.nom), np = normLogin(c.prenom);
    const exact = byName.get(`${nn}|${np}`);
    if (exact && new Set(exact).size === 1) return { pxx: exact[0], how: "nom+prenom" };
    if (exact && exact.length > 1) return { pxx: null, how: "ambigu" };
    const init = byNomInit.get(`${nn}|${np[0] || ""}`);
    if (init && new Set(init).size === 1) return { pxx: init[0], how: "nom+initiale" };
    if (init && init.length > 1) return { pxx: null, how: "ambigu" };
    // Palier patronyme composé : l'annuaire porte un nom plus complet que celui
    // tapé sur HelloAsso (« Bonnefoy » vs « Bonnefoy-à-l'anne »). On exige que le
    // prénom concorde (égal ou initiale) ET que l'un des noms soit sous-chaîne de
    // l'autre, et qu'un seul candidat ressorte (sinon on laisse à réconcilier).
    if (nn.length >= 4) {
      const cand = new Set();
      for (const r of roster) {
        const rn = normLogin(r.nom), rp = normLogin(r.prenom);
        if (!rn || !rp) continue;
        const prenomOk = rp === np || (np && rp[0] === np[0]);   // égal ou même initiale
        if (prenomOk && (rn.includes(nn) || nn.includes(rn))) cand.add(r.pxx);
      }
      if (cand.size === 1) return { pxx: [...cand][0], how: "nom-compose" };
      if (cand.size > 1) return { pxx: null, how: "ambigu" };
    }
    return { pxx: null, how: "introuvable" };
  };
}

async function main() {
  const cotisants = loadCotisants(CSV);
  const mysql = (await import("mysql2/promise")).default;
  const pool = await mysql.createPool({
    host: process.env.DB_MYSQL_HOST, user: process.env.DB_MYSQL_USER,
    database: process.env.DB_MYSQL_DATABASE, password: process.env.DB_MYSQL_PASSWORD,
  });
  const [roster] = await pool.query("SELECT pxx, email, prenom, nom FROM roster");
  const match = makeMatcher(roster);

  const matched = new Set(), unresolved = [];
  const byHow = {};
  for (const c of cotisants) {
    const m = match(c);
    byHow[m.how] = (byHow[m.how] || 0) + 1;
    if (m.pxx) matched.add(m.pxx);
    else unresolved.push(`${c.prenom} ${c.nom} <${c.email}> [${m.how}]`);
  }

  console.log(`[import-cotisants] ${cotisants.length} cotisants BDA dans le CSV`);
  console.log(`[import-cotisants] appariés: ${matched.size} (par ${JSON.stringify(byHow)})`);
  console.log(`[import-cotisants] non résolus (${unresolved.length}) :`);
  unresolved.forEach(u => console.log(`   - ${u}`));

  if (DRY) { console.log("[import-cotisants] --dry : aucune écriture."); await pool.end(); return; }

  await pool.query("UPDATE roster SET cotisant = 0");
  if (matched.size) {
    const list = [...matched];
    await pool.query(`UPDATE roster SET cotisant = 1 WHERE pxx IN (${list.map(() => "?").join(",")})`, list);
  }
  const [[{ c }]] = await pool.query("SELECT COUNT(*) c FROM roster WHERE cotisant = 1");
  console.log(`[import-cotisants] appliqué : ${c} cotisants marqués dans le roster.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

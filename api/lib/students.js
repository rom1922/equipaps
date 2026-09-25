// Dérivation de pxx + upsert roster (partagés par la sync portail et les
// ajouts manuels). equipaps n'écrit jamais vers le portail, il ingère une copie.

import { normLogin, normSearch } from "./normalize.js";

// Dérive un pxx neuf, unique, pour un élève non déjà attaché (même algorithme
// que sync-roster : promo + nom tronqué, initiale du prénom en suffixe, filet
// id unique).
export function derivePxx(student, usedPxx) {
  const used = new Set(usedPxx);
  const p = student.promo;
  const base = (p + student.nnom).slice(0, 10);
  if (!used.has(base)) return base;
  const init = student.nprenom[0] || "x";
  for (let n = 0; n <= 50; n++) {
    const suffix = init + (n === 0 ? "" : String(n));
    const keep = Math.max(0, 10 - p.length - suffix.length);
    const cand = (p + student.nnom.slice(0, keep) + suffix).slice(0, 10);
    if (!used.has(cand)) return cand;
  }
  const fb = (p.slice(0, 2) + student.id).slice(0, 10);          // filet : id unique
  let c = fb, k = 0;
  while (used.has(c)) c = (p.slice(0, 1) + student.id + (k++)).slice(0, 10);
  return c;
}

export function searchKeyOf(prenom, nom) {
  return normSearch(`${prenom || ""} ${nom || ""}`);
}

// Item de l'API annuaire du portail des élèves (brique 2026-09-25) -> forme
// "student" partagée avec l'import mineurs.json. Les ids du portail sont les
// MÊMES que ceux de l'annuaire scrapé : les jointures source_id restent valides.
export function annuaireToStudent(item, uploadBase) {
  return {
    id: String(item.id),
    prenom: item.prenom || "",
    nom: item.nom || "",
    email: item.email || null,
    promo: String(item.promotion ?? ""),
    photo_url: item.photo ? `${uploadBase}/${item.photo}` : null,
    nnom: normLogin(item.nom),
    nprenom: normLogin(item.prenom),
  };
}

// Construit l'upsert d'une liste d'élèves contre le roster existant : rangée
// déjà attachée par source_id -> mise à jour (pxx et cotisant PRÉSERVÉS) ;
// sinon pxx dérivé neuf. Partagé par l'import annuaire PDM et la sync portail.
export function buildRosterUpsert(students, existing) {
  const bySource = new Map(existing.filter(r => r.source_id).map(r => [r.source_id, r]));
  const usedPxx = new Set(existing.map(r => r.pxx));
  const updates = [], inserts = [];
  for (const s of students) {
    if (!s.nnom) continue;                                 // sans patronyme utile
    const row = bySource.get(s.id);
    if (row) {
      if (row.prenom !== s.prenom || row.nom !== s.nom || row.email !== s.email || row.promo !== s.promo) {
        updates.push({ pxx: row.pxx, prenom: s.prenom, nom: s.nom, email: s.email, promo: s.promo, photo_url: s.photo_url, search_key: searchKeyOf(s.prenom, s.nom) });
      }
    } else {
      const pxx = derivePxx(s, usedPxx);
      usedPxx.add(pxx);
      inserts.push({ pxx, prenom: s.prenom, nom: s.nom, email: s.email, promo: s.promo, photo_url: s.photo_url, search_key: searchKeyOf(s.prenom, s.nom), source_id: s.id });
    }
  }
  return { updates, inserts };
}

// Applique l'upsert en UNE transaction (conn = connexion mysql2 ouverte).
export async function applyRosterUpsert(conn, updates, inserts) {
  const now = new Date();
  for (const u of updates) {
    await conn.query(
      "UPDATE roster SET prenom=?, nom=?, email=?, promo=?, photo_url=?, search_key=?, synced_at=? WHERE pxx=?",
      [u.prenom, u.nom, u.email, u.promo, u.photo_url, u.search_key, now, u.pxx]
    );
  }
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const batch = inserts.slice(i, i + CHUNK);
    await conn.query(
      `INSERT INTO roster (pxx, prenom, nom, email, promo, photo_url, search_key, cotisant, source_id, synced_at) VALUES ?
         ON DUPLICATE KEY UPDATE
           prenom=VALUES(prenom), nom=VALUES(nom), email=VALUES(email), promo=VALUES(promo),
           photo_url=VALUES(photo_url), search_key=VALUES(search_key),
           source_id=COALESCE(VALUES(source_id), source_id), synced_at=VALUES(synced_at)`,
      [batch.map(r => [r.pxx, r.prenom, r.nom, r.email, r.promo, r.photo_url, r.search_key, 0, r.source_id, now])]
    );
  }
}

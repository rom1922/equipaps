// Réconciliation HelloAsso -> roster, extraite de api/scripts/import-cotisants.js
// en fonctions PURES, testables sans base (le CLI et la route d'import admin
// partagent exactement cette logique).
//
// Filtre HelloAsso : Statut in {Validé, Hors-ligne} ET Tarif contient
// « Cotisation BDA » (exclut « salle ins' seule », « Anciens », « mi année »).
// Matching contre le roster : email d'abord, puis nom+prénom, puis nom +
// initiale du prénom (l'annuaire PDM tronque parfois le prénom), puis palier
// patronyme composé.
//
// Décision (Vicente, 2026-09-24) : un cotisant NON apparié devient une rangée
// roster persistante (cotisant=1, non cherchable, source_id='helloasso') —
// buildPhantomRows — visible dans la vue admin « à rattacher ».

import { normLogin } from "./normalize.js";
import { parseCsv } from "./csv.js";

// Charge les cotisants BDA depuis le TEXTE de l'export HelloAsso.
export function loadCotisantsFromText(text) {
  const raw = (text || "").replace(/^﻿/, "");
  const rows = parseCsv(raw);
  if (!rows.length) throw new Error("fichier vide");
  const head = rows[0].map(h => h.trim());
  const idx = (name) => head.findIndex(h => h.toLowerCase().startsWith(name.toLowerCase()));
  const iStatut = idx("statut"), iNom = idx("nom adhérent"), iPrenom = idx("prénom adhérent"),
        iEmail = idx("email payeur"), iTarif = idx("tarif");
  if (iNom < 0 || iPrenom < 0 || iTarif < 0) throw new Error("colonnes attendues introuvables (nom adhérent / prénom adhérent / tarif)");
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
export function makeMatcher(roster) {
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
    // prénom concorde (égal ou initiale) ET que l'un des noms soit sous-chaîne
    // de l'autre, et qu'un seul candidat ressorte (sinon on laisse à réconcilier).
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

// Jusqu'à 3 candidats pour un non-résolu (coquilles HelloAsso, pseudos) :
// même nom (prénom divergent), puis parenté de nom (l'un sous-chaîne de
// l'autre), promo fournie pour lever les homonymes côté UI.
export function suggest(cotisant, roster, max = 3) {
  const nn = normLogin(cotisant.nom), np = normLogin(cotisant.prenom);
  if (!nn) return [];
  const sameNom = [], nearNom = [];
  for (const r of roster) {
    if (!r.search_key) continue;                       // seules les rangées cherchables (vrais élèves)
    const rn = normLogin(r.nom), rp = normLogin(r.prenom);
    if (!rn || !rp) continue;
    if (rn === nn) sameNom.push(r);
    else if (rn.length >= 4 && nn.length >= 4 && (rn.includes(nn) || nn.includes(rn))) nearNom.push(r);
  }
  const out = [], seen = new Set();
  for (const r of [...sameNom, ...nearNom]) {
    if (seen.has(r.pxx)) continue;
    seen.add(r.pxx);
    out.push({ pxx: r.pxx, prenom: r.prenom, nom: r.nom, promo: r.promo });
    if (out.length >= max) break;
  }
  return out;
}

// Réconcilie toute la liste : renvoie les appariés (pxx, par méthode) et les
// non-résolus avec suggestions — SANS effet de bord, utilisable en dry-run.
export function reconcile(cotisants, roster) {
  const match = makeMatcher(roster);
  const matched = new Map();   // pxx -> how
  const byHow = {};
  const unresolved = [];
  for (const c of cotisants) {
    const m = match(c);
    if (m.pxx) {
      matched.set(m.pxx, m.how);
      byHow[m.how] = (byHow[m.how] || 0) + 1;
    } else {
      byHow[m.how] = (byHow[m.how] || 0) + 1;
      unresolved.push({ ...c, how: m.how, suggestions: suggest(c, roster) });
    }
  }
  return {
    total: cotisants.length,
    matchedCount: matched.size,
    byHow,
    matched: [...matched.keys()],
    unresolved,
  };
}

// Rangées persistantes pour les non-résolus : cotisant=1, NON cherchables
// (search_key null, invisibles côté élève), source_id='helloasso'. L'admin les
// rattache ensuite au vrai pxx (attach) ou les valide en entrée définitive.
export function buildPhantomRows(unresolved, usedPxx) {
  const used = new Set(usedPxx);
  const rows = [];
  const seen = new Set();
  for (const u of unresolved) {
    const nn = normLogin(u.nom), np = normLogin(u.prenom);
    if (!nn) continue;
    const key = `${nn}|${np}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let pxx = ("h" + nn).slice(0, 10);
    let n = 0;
    while (used.has(pxx)) {
      const suffix = String(++n);
      pxx = ("h" + nn.slice(0, 9 - suffix.length) + suffix).slice(0, 10);
    }
    used.add(pxx);
    rows.push({
      pxx, prenom: u.prenom || null, nom: u.nom || null, email: u.email || null,
      promo: null, photo_url: null, search_key: null, cotisant: 1,
      source_id: "helloasso",
    });
  }
  return rows;
}

// Application en UNE transaction (conn = connexion mysql2 déjà ouverte) :
// reset cotisant=0 partout, =1 sur les appariés, suppression des rangées
// « helloasso » d'un import précédent (sans historique de tirage : elles sont
// recalculées de bout en bout par chaque export complet), insertion des
// nouvelles rangées des non-résolus. Sans transaction, un tirage concurrent
// verrait un instant zéro cotisant.
export async function applyReconciliation(conn, report, phantomRows) {
  await conn.query("UPDATE roster SET cotisant = 0");
  if (report.matched.length) {
    await conn.query("UPDATE roster SET cotisant = 1 WHERE pxx IN (?)", [report.matched]);
  }
  await conn.query(
    `DELETE r FROM roster r WHERE r.source_id = 'helloasso'
       AND NOT EXISTS (SELECT 1 FROM paps p WHERE p.pxx = r.pxx)
       AND NOT EXISTS (SELECT 1 FROM hpaps h WHERE h.pxx = r.pxx)
       AND NOT EXISTS (SELECT 1 FROM resultats x WHERE x.pxx = r.pxx)`
  );
  if (phantomRows.length) {
    const now = new Date();
    await conn.query(
      `INSERT INTO roster (pxx, prenom, nom, email, promo, photo_url, search_key, cotisant, source_id, synced_at) VALUES ?`,
      [phantomRows.map(r => [r.pxx, r.prenom, r.nom, r.email, r.promo, r.photo_url, r.search_key, 1, r.source_id, now])]
    );
  }
  const [[{ c }]] = await conn.query("SELECT COUNT(*) c FROM roster WHERE cotisant = 1");
  return c;
}

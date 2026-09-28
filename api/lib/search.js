// Recherche floue par nom (roster). Fonction PURE, testable sans base :
// - on découpe la requête en MOTS ; chaque mot doit s'apparier à un mot du
//   nom (prénom ou nom), indépendamment de l'ordre ;
// - un mot matche par PRÉFIXE (n'importe quel sens), sinon par similarité
//   Jaro-Winkler (coquilles, lettres inversées : « gint » ~ « giunta ») ;
// - score global = somme des meilleures similarités, top N par score.
//
// Normalisation via normSearch : minuscules, sans accents, tirets et
// apostrophes -> espaces. La casse et les accents sont donc couverts d'office.

import { normSearch } from "./normalize.js";

// Jaro (standard, ~20 lignes) : 1.0 = identique. Gère bien les transpositions
// (« giunat ») et les lettres manquantes (« gint »). Sans le bonus de préfixe
// de Winkler : ce bonus colle « marc » sur « marie » (0,85) au-dessus du seuil
// quand « gint »~« giunta » est à 0,81 — indissociables ; le Jaro pur sépare.
function jaro(a, b) {
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aHit = new Array(la).fill(false);
  const bHit = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window), hi = Math.min(lb - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!bHit[j] && a[i] === b[j]) { aHit[i] = bHit[j] = true; m++; break; }
    }
  }
  if (m === 0) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (m / la + m / lb + (m - t) / m) / 3;
}

// Seuil de similarité en dessous duquel deux mots ne s'apparient pas.
export const SEUIL = 0.80;

// Similarité entre un mot de requête et un mot du nom :
//   identiques -> 1 ; préfixe (dans un sens ou l'autre) -> 0.95 ;
//   mots trop courts -> 0 sauf préfixe (Jaro trop jumpy sur 1-2 lettres) ;
//   sinon similarité de Jaro.
export function similarite(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.startsWith(a) || a.startsWith(b)) return 0.95;
  if (a.length < 3 || b.length < 3) return 0;
  return jaro(a, b);
}

// Tokens du nom : « Romain Giunta » -> ["romain", "giunta"] ; les noms
// composés donnent leurs morceaux (« de riviere » -> de + riviere).
export function tokensNom(prenom, nom) {
  return (normSearch(`${prenom || ""} ${nom || ""}`)).split(" ").filter(Boolean);
}

// Le cœur : chaque mot de la requête doit s'apparier à un mot du nom
// (meilleure similarité >= SEUIL). Score = somme des meilleures similarités.
export function scoreEtudiant(qTokens, nomTokens) {
  if (!qTokens.length || !nomTokens.length) return 0;
  let score = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const n of nomTokens) {
      const s = similarite(q, n);
      if (s > best) best = s;
    }
    if (best < SEUIL) return 0;           // un mot non apparié = écarté
    score += best;
  }
  return score;
}

// Promo en nombre (« 25 » -> 25) pour le tri ; inconnue -> -1 (dernière).
function promoNum(e) {
  const p = parseInt(e.promo, 10);
  return Number.isFinite(p) ? p : -1;
}

// Recherche sur une liste d'étudiants { prenom, nom, promo, ... } (le roster
// en mémoire). Deux critères de tri, dans cet ordre :
//   1. score du nom décroissant (la qualité du match gouverne TOUJOURS) ;
//   2. à qualité égale, la promo la plus récente d'abord — taper « elena »
//      liste les Elena récentes avant les anciennes ; une Elena de P02 ne
//      monte que si son nom matche strictement mieux que les autres.
// Les rangées sans nom (legacy) sont écartées.
export function chercherEtudiants(query, etudiants, limit = 8) {
  const qTokens = normSearch(query).split(" ").filter(Boolean);
  if (!qTokens.length) return [];
  const out = [];
  for (const e of etudiants) {
    if (!e.search_key && !(e.prenom || e.nom)) continue;
    const tokens = e._tok || tokensNom(e.prenom, e.nom);
    const score = scoreEtudiant(qTokens, tokens);
    if (score > 0) out.push({ e, score });
  }
  out.sort((x, y) => y.score - x.score || promoNum(y.e) - promoNum(x.e));
  return out.slice(0, limit).map(x => x.e);
}

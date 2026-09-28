// Tests de la recherche floue (node --test). Fonction pure, aucune DB.
// Cas demandés par Vicente (Romain Giunta) : romain g, giunta ro,
// roman giunt, gint roma — plus casse, accents, noms composés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chercherEtudiants, similarite, tokensNom } from "./search.js";

const R = (pxx, prenom, nom, promo = "25") => ({ pxx, prenom, nom, promo, search_key: `${prenom} ${nom}`.toLowerCase() });
// Petit roster réaliste : l'homonyme, les tirets, les accents.
const roster = [
  R("25giunta", "Romain", "Giunta"),
  R("24giunta", "Léa", "Giunta"),
  R("25durand", "Romain", "Durand"),
  R("26mlln", "Jeanne", "Millon"),
  R("25bdv", "Camille", "Baudin de Vauberne"),
  R("25hllr", "Alice", "Hélie"),
];
const px = (query) => chercherEtudiants(query, roster).map(r => r.pxx);
const px2 = (list, query) => chercherEtudiants(query, list).map(r => r.pxx);

test("exact : prenom nom, nom seul, prenom seul", () => {
  assert.deepEqual(px("romain giunta"), ["25giunta"]);
  assert.deepEqual(px("giunta"), ["25giunta", "24giunta"]);
  assert.ok(px("romain").includes("25giunta"));
});

test("tokens partiels et ordre libre : romain g, giunta ro", () => {
  assert.equal(px("romain g")[0], "25giunta");
  assert.equal(px("giunta ro")[0], "25giunta");
});

test("coquilles : roman giunt, gint roma, romain gintua", () => {
  assert.equal(px("roman giunt")[0], "25giunta");
  assert.equal(px("gint roma")[0], "25giunta");
  assert.equal(px("romain gintua")[0], "25giunta");
});

test("casse et accents : ROMAIN GIUNTA, Romain Giünta -> non, giunta accentué", () => {
  assert.equal(px("ROMAIN GIUNTA")[0], "25giunta");
  assert.equal(px("romain giünta")[0], "25giunta");   // ü normalisé en u
  assert.equal(px("léa giunta")[0], "24giunta");      // é normalisé
});

test("noms composés : baudin de vauberne par morceaux", () => {
  assert.ok(px("camille vauberne").includes("25bdv"));
  assert.ok(px("baudin camille").includes("25bdv"));
  assert.ok(px("de vauberne").includes("25bdv"));
});

test("un mot non apparié écarte la rangée", () => {
  assert.deepEqual(px("romain trucmuch"), []);
});

test("similarité : préfixe > JW > seuil > bruit", () => {
  assert.equal(similarite("giunta", "giunta"), 1);
  assert.ok(similarite("g", "giunta") >= 0.95);
  assert.ok(similarite("gint", "giunta") >= 0.82);
  assert.ok(similarite("roman", "romain") >= 0.82);
  assert.ok(similarite("marc", "marie") < 0.82);   // pas de faux positif évident
});

test("tokens : découpe, normalisation, sans vide", () => {
  assert.deepEqual(tokensNom("Jean-Romain", "L'Hélie"), ["jean", "romain", "l", "helie"]);
  assert.deepEqual(tokensNom(null, null), []);
});

test("promo : à qualité égale, la promo récente d'abord (elena seul)", () => {
  const elenas = [
    R("02elena", "Elena", "Dupont", "02"),
    R("26elena", "Elena", "Martin", "26"),
    R("25elena", "Elena", "Rossi", "25"),
  ];
  assert.deepEqual(px2(elenas, "elena"), ["26elena", "25elena", "02elena"]);
});

test("promo : le nom complet d'une ancienne promo gagne quand même", () => {
  const elenas = [
    R("02elena", "Elena", "Dupont", "02"),
    R("25elena", "Elena", "Rossi", "25"),
  ];
  // requête partielle « elena dup » : la Dupont (P02) matche mieux que la
  // Rossi (P25) -> elle monte, malgré son âge.
  assert.equal(px2(elenas, "elena dup")[0], "02elena");
  // mais à match égal sur le nom complet, la récente passe devant.
  const homonymes = [
    R("02elena", "Elena", "Dupont", "02"),
    R("25elena", "Elena", "Dupont", "25"),
  ];
  assert.deepEqual(px2(homonymes, "elena dupont"), ["25elena", "02elena"]);
});

test("rangées sans nom (legacy) écartées, jamais renvoyées", () => {
  const avecLegacy = [...roster, { pxx: "25xxxx", prenom: null, nom: null, search_key: null }];
  assert.ok(!px("romain").some(p => p === "25xxxx"));
});

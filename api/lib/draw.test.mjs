// Tests des règles de tirage. `obtentions` = participations du même type
// que l'événement, dans le référentiel de comptage courant (calcul côté API). (node --test). Fonction pure, aucune DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankRegistrants, winners, avecPlacesEnAttente } from "./draw.js";

const deadline = new Date(1000); // paps + 24 h, en ms pour la lisibilité
const u = (pxx, sorties, cotisant, tMs) => ({
  pxx, obtentions: sorties, cotisant, date: new Date(tMs),
});
const ids = (arr) => arr.map((x) => x.pxx);

test("groupe prioritaire : le moins servi devant (sorties croissant)", () => {
  const r = rankRegistrants([u("A", 2, false, 100), u("B", 0, false, 200), u("C", 1, false, 150)], deadline);
  assert.deepEqual(ids(r), ["B", "C", "A"]);
});

test("à égalité de sorties, le cotisant passe devant (même s'il s'inscrit après)", () => {
  const r = rankRegistrants([u("A", 1, false, 100), u("B", 1, true, 200)], deadline);
  assert.deepEqual(ids(r), ["B", "A"]);
});

test("à égalité de sorties et de cotisation, l'ordre d'inscription tranche", () => {
  const r = rankRegistrants([u("A", 1, true, 200), u("B", 1, true, 100)], deadline);
  assert.deepEqual(ids(r), ["B", "A"]);
});

test("un inscrit tardif passe TOUJOURS derrière les prioritaires, quel que soit son mérite", () => {
  // A : prioritaire, 5 sorties, non cotisant. B : tardif, 0 sortie, cotisant.
  const r = rankRegistrants([u("A", 5, false, 100), u("B", 0, true, 2000)], deadline);
  assert.deepEqual(ids(r), ["A", "B"]);
});

test("entre inscrits tardifs : premier arrivé premier servi, sans priorité", () => {
  // B arrive avant A ; le mérite (sorties/cotisant) est ignoré après 24 h.
  const r = rankRegistrants([u("A", 0, true, 2000), u("B", 5, false, 1500)], deadline);
  assert.deepEqual(ids(r), ["B", "A"]);
});

test("scénario mixte complet", () => {
  const r = rankRegistrants([
    u("prioA", 3, false, 100),   // prioritaire, bcp de sorties
    u("prioB", 0, false, 300),   // prioritaire, jamais servi
    u("prioC", 0, true, 400),    // prioritaire, jamais servi, cotisant
    u("tardX", 0, true, 1500),   // tardif
    u("tardY", 0, false, 1200),  // tardif, arrivé avant tardX
  ], deadline);
  // Prioritaires d'abord (0 sorties: cotisant C avant B ; puis A à 3 sorties),
  // puis tardifs par ordre d'arrivée (Y avant X).
  assert.deepEqual(ids(r), ["prioC", "prioB", "prioA", "tardY", "tardX"]);
});

test("les gagnants sont les N premières places", () => {
  const list = [u("A", 2, false, 100), u("B", 0, false, 200), u("C", 1, false, 150)];
  assert.deepEqual(ids(winners(list, deadline, 2)), ["B", "C"]);
  assert.equal(winners(list, deadline, 0).length, 0);
});

test("tri stable : à date égale, l'ordre d'entrée (date, id) fait foi", () => {
  // Le serveur fournit les inscrits triés par (date, id) : une égalité à la
  // milliseconde ne doit jamais être remélangée (revue adverse O3).
  const t = new Date(1000);
  const r = rankRegistrants([u("A", 0, false, t), u("B", 0, false, t), u("C", 0, false, t)], deadline);
  assert.deepEqual(ids(r), ["A", "B", "C"]);
});

test("la borne de 24 h est stricte : pile à la deadline reste prioritaire", () => {
  // date == deadline -> non tardif (aLate = date > deadline, faux à égalité).
  const r = rankRegistrants([u("late", 0, true, 1001), u("edge", 9, false, 1000)], deadline);
  assert.deepEqual(ids(r), ["edge", "late"]);
});

// --- Places en attente ailleurs (tirages ouverts simultanés, 2026-09-29) ---

test("avecPlacesEnAttente : une place retenue ailleurs, plus ancienne, pèse comme une obtention", () => {
  // X (l'événement tiré) : A inscrit à t=300, B inscrit à t=100, les deux 0 sortie.
  // A est actuellement retenu dans l'autre tirage ouvert (inscription à t=50, plus ancienne).
  const users = [u("A", 0, false, 300), u("B", 0, false, 100)];
  const pendances = new Map([["A", [new Date(50)]]]);
  const r = rankRegistrants(avecPlacesEnAttente(users, pendances), deadline);
  // B (0 effective) passe devant A (0 gellée + 1 en attente).
  assert.deepEqual(ids(r), ["B", "A"]);
});

test("avecPlacesEnAttente : l'inscription la plus ancienne est protégée (pas de pénalité croisée)", () => {
  // A est retenu dans les DEUX tirages : inscrit dans X à t=100 (ancien) et
  // dans l'autre à t=300 (récent). Dans X, la place en attente de l'autre
  // tirage est PLUS RÉCENTE : elle ne pénalise pas — A reste à 0 effective.
  const users = [u("A", 0, false, 100), u("B", 0, false, 50)];
  const pendances = new Map([["A", [new Date(300)]]]);
  const r = rankRegistrants(avecPlacesEnAttente(users, pendances), deadline);
  // Mérite égal avec B (0 effective chacun), B s'est inscrit avant : B devant.
  assert.deepEqual(ids(r), ["B", "A"]);
  // Et le champ enAttente n'est pas posé (la place récente ne pénalise pas).
  const aug = avecPlacesEnAttente(users, pendances);
  assert.equal(aug.find(x => x.pxx === "A").enAttente, undefined);
});

test("avecPlacesEnAttente : deux places en attente plus anciennes comptent double", () => {
  const users = [u("A", 0, false, 300), u("B", 1, false, 100)];
  const pendances = new Map([["A", [new Date(50), new Date(80)]]]);
  const r = rankRegistrants(avecPlacesEnAttente(users, pendances), deadline);
  // A : 0 + 2 en attente = 2, B : 1 -> B devant.
  assert.deepEqual(ids(r), ["B", "A"]);
});

test("avecPlacesEnAttente : une place en attente d'un autre type ne remonte pas ici", () => {
  // Le filtrage par type vit côté API (pendancesPour ne sonde que les
  // événements ouverts du même type) ; ici, pas d'entrée = pas de pénalité.
  const users = [u("A", 0, false, 300), u("B", 0, false, 100)];
  const r = rankRegistrants(avecPlacesEnAttente(users, new Map()), deadline);
  assert.deepEqual(ids(r), ["B", "A"]);
});

test("la pénalité ne change pas le groupe : un tardif reste derrière les prioritaires", () => {
  const users = [u("A", 0, false, 100), u("B", 0, true, 2000)];
  const pendances = new Map([["A", [new Date(50)]]]);
  const r = rankRegistrants(avecPlacesEnAttente(users, pendances), deadline);
  assert.deepEqual(ids(r), ["A", "B"]);
});

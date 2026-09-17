// Tests des règles de tirage (node --test). Fonction pure, aucune DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankRegistrants, winners } from "./draw.js";

const deadline = new Date(1000); // paps + 24 h, en ms pour la lisibilité
const u = (pxx, sorties, cotisant, tMs) => ({
  pxx, sortiesEffectuees: sorties, cotisant, date: new Date(tMs),
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

test("la borne de 24 h est stricte : pile à la deadline reste prioritaire", () => {
  // date == deadline -> non tardif (aLate = date > deadline, faux à égalité).
  const r = rankRegistrants([u("late", 0, true, 1001), u("edge", 9, false, 1000)], deadline);
  assert.deepEqual(ids(r), ["edge", "late"]);
});

// Tests purs de la réconciliation HelloAsso (aucune base requise).
//   node --test api/lib/cotisants.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "./csv.js";
import {
  loadCotisantsFromText, reconcile, suggest, buildPhantomRows,
} from "./cotisants.js";

const HEAD = "Statut;Nom adhérent;Prénom adhérent;Email payeur;Tarif de l'inscription";
const csvLine = (statut, nom, prenom, email, tarif) =>
  `${statut};${nom};${prenom};${email};${tarif}`;

test("parseCsv : séparateur ;, guillemets, guillemets échappés", () => {
  const rows = parseCsv('a;b;"c;d";"e""f"\r\nx;y;z');
  assert.deepEqual(rows[0], ["a", "b", "c;d", 'e"f']);
  assert.deepEqual(rows[1], ["x", "y", "z"]);
});

test("parseCsv : dernière ligne sans saut de finale", () => {
  assert.deepEqual(parseCsv("a;b"), [["a", "b"]]);
});

test("loadCotisantsFromText : filtre statut et tarif, BOM tolérée", () => {
  const text = [
    HEAD,
    csvLine("Validé", "Durand", "Marie", "Marie.Durand@etu.minesparis.psl.eu", "Cotisation BDA - Tarif Normal"),
    csvLine("Validé", "Martin", "Luc", "luc@x.fr", "Salle ins' seule"),          // tarif exclu
    csvLine("En attente", "Blanc", "Anna", "anna@x.fr", "Cotisation BDA - Normal"), // statut exclu
    csvLine("Hors-ligne", "Noir", "Jules", "jules@x.fr", "Cotisation BDA - Ancien"), // hors-ligne ok
    csvLine("Validé", "", "SansNom", "s@x.fr", "Cotisation BDA"),
  ].join("\n");
  const out = loadCotisantsFromText("﻿" + text);
  assert.equal(out.length, 3);   // Martin (tarif exclu) et Blanc (statut exclu) sont écartés
  assert.deepEqual(out[0], { nom: "Durand", prenom: "Marie", email: "marie.durand@etu.minesparis.psl.eu", tarif: "Cotisation BDA - Tarif Normal" });
  assert.equal(out[1].nom, "Noir");
  assert.equal(out[2].nom, "");   // ligne sans nom : passe le filtre (parité), sera non-résolue
});

test("loadCotisantsFromText : colonnes manquantes -> erreur claire", () => {
  assert.throws(() => loadCotisantsFromText("A;B\n1;2"), /introuvables/);
});

// Roster de fixture : pxx, prenom, nom, email, search_key (cherchables).
const ROSTER = [
  { pxx: "25durand", prenom: "Marie", nom: "Durand", email: "marie.durand@etu.minesparis.psl.eu", search_key: "marie durand", promo: "25" },
  { pxx: "25durandm", prenom: "Marc", nom: "Durand", email: "marc@etu.fr", search_key: "marc durand", promo: "25" },
  { pxx: "26bonnef", prenom: "Lea", nom: "Bonnefoy-à-l'anne", email: "lea@etu.fr", search_key: "lea bonnefoy a l anne", promo: "26" },
  { pxx: "24petit", prenom: "Jean-Baptiste", nom: "Petit", email: null, search_key: "jean baptiste petit", promo: "24" },
  { pxx: "25moreau", prenom: "Lucie", nom: "Moreau", email: "l1@etu.fr", search_key: "lucie moreau", promo: "25" },
  { pxx: "25moreaux", prenom: "Lucie", nom: "Moreau", email: "l2@etu.fr", search_key: "lucie moreau", promo: "25" }, // homonyme verbatim -> ambigu
  { pxx: "legacy1", prenom: null, nom: null, email: null, search_key: null, promo: null }, // legacy non cherchable
];

test("reconcile : email d'abord", () => {
  const r = reconcile([{ nom: "Nom Inconnu", prenom: "X", email: "marie.durand@etu.minesparis.psl.eu", tarif: "t" }], ROSTER);
  assert.equal(r.matchedCount, 1);
  assert.equal(r.matched[0], "25durand");
  assert.equal(r.byHow["email"], 1);
});

test("reconcile : nom+prénom, nom+initiale, patronyme composé", () => {
  const r = reconcile([
    { nom: "Durand", prenom: "Marc", email: "", tarif: "t" },          // nom+prénom
    { nom: "Petit", prenom: "Jean-Bap", email: "", tarif: "t" },       // prénom tronqué -> initiale unique
    { nom: "Bonnefoy", prenom: "Lea", email: "", tarif: "t" },         // patronyme composé
  ], ROSTER);
  assert.equal(r.matchedCount, 3);
  assert.deepEqual(r.byHow, { "nom+prenom": 1, "nom+initiale": 1, "nom-compose": 1 });
  assert.ok(r.matched.includes("25durandm"));
  assert.ok(r.matched.includes("26bonnef"));
});

test("reconcile : ambigu (homonymes) et introuvable deviennent des non-résolus", () => {
  const r = reconcile([
    { nom: "Moreau", prenom: "Lucie", email: "", tarif: "t" },         // deux Lucie Moreau -> ambigu
    { nom: "Grutubude", prenom: "Zorro", email: "", tarif: "t" },       // introuvable
  ], ROSTER);
  assert.equal(r.matchedCount, 0);
  assert.equal(r.unresolved.length, 2);
  assert.equal(r.unresolved[0].how, "ambigu");
  assert.equal(r.unresolved[1].how, "introuvable");
});

test("suggest : candidats par nom, sans les rangées non cherchables, max 3", () => {
  const s = suggest({ nom: "Durand", prenom: "Marie", email: "" }, ROSTER);
  assert.ok(s.length >= 1 && s.length <= 3);
  assert.ok(s.some(c => c.pxx === "25durand"));
  assert.ok(!s.some(c => c.pxx === "legacy1"));
  const s2 = suggest({ nom: "Durandy", prenom: "Marie", email: "" }, ROSTER); // coquille : parenté de nom
  assert.ok(s2.some(c => c.pxx === "25durand"));
});

test("buildPhantomRows : rangées persistantes non cherchables, dédupliquées, pxx uniques", () => {
  const rows = buildPhantomRows([
    { nom: "Grutubude", prenom: "Zorro", email: "z@x.fr" },
    { nom: "grutubude", prenom: "Zorro", email: "z@x.fr" },   // doublon -> une seule rangée
    { nom: "Durand", prenom: "Perso", email: "" },             // pxx dérivé
  ], ["hdurand", "25durand"]);
  assert.equal(rows.length, 2);
  const zorro = rows.find(r => r.pxx.startsWith("hgrutubude"));
  assert.ok(zorro);
  assert.equal(zorro.cotisant, 1);
  assert.equal(zorro.source_id, "helloasso");
  assert.equal(zorro.search_key, null);
  const durand = rows.find(r => r.pxx !== zorro.pxx);
  assert.notEqual(durand.pxx, "hdurand");   // déjà pris -> suffixé
  assert.ok(durand.pxx.startsWith("h"));
  assert.ok(durand.pxx.length <= 10);
});

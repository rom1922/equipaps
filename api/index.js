import express from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./db/schema.js";
import dotenv from "dotenv";
import { and, eq, gte } from "drizzle-orm";
import jsonwebtoken from "jsonwebtoken";
import multer from "multer";
import { normLogin, normSearch } from "./lib/normalize.js";
import { rankRegistrants } from "./lib/draw.js";
import {
  loadCotisantsFromText, reconcile, buildPhantomRows, applyReconciliation, suggest,
} from "./lib/cotisants.js";
import {
  derivePxx, searchKeyOf, annuaireToStudent, buildRosterUpsert, applyRosterUpsert,
} from "./lib/students.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = await mysql.createPool({
  host: process.env.DB_MYSQL_HOST,
  user: process.env.DB_MYSQL_USER,
  database: process.env.DB_MYSQL_DATABASE,
  password: process.env.DB_MYSQL_PASSWORD,
  idleTimeout: 10000,
  enableKeepAlive: true
})

const db = drizzle(pool, { schema, mode: "default" });

function generateId() {
  let uid = '';
  let chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < 16; i++) {
    uid += chars[Math.floor(Math.random() * chars.length)];
  }
  return uid;
}

async function generateTableId(table) {
  var uid;
  // generate a random unused uid
  while (true) {
    uid = generateId();
    var rows = await db
      .select()
      .from(table)
      .where(eq(table.id, uid));
    if (rows.length == 0) return uid;
  }
}

// Base élèves = table `roster` (sync lecture seule depuis l'annuaire PDM
// mineurs.json, cf. api/scripts/sync-roster.js et l'import admin). Remplace
// users.txt. L'identité reste le login portail `pxx`. Chargée en mémoire
// (recherche rapide) ; reloadRoster() rafraîchit le cache après chaque
// import/édition admin — plus jamais de restart service pour ça.
async function loadRoster() {
  try {
    return await db.select().from(schema.roster);
  } catch (err) {
    console.error("roster indisponible (table absente ? lancer sync-roster) :", err.message);
    return [];
  }
}
let roster = [];
let rosterByPxx = new Map();
async function reloadRoster() {
  roster = await loadRoster();
  rosterByPxx = new Map(roster.map(r => [r.pxx, r]));
  console.log(`roster chargé : ${roster.length} élèves (${roster.filter(r => r.search_key).length} recherchables)`);
}
await reloadRoster();

// Upload admin en mémoire (jamais écrit sur disque), 2 Mo max.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const eventPasswordHashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(process.env.EVENT_PASSWORD || ""));
const eventPasswordHashHex = Array.from(new Uint8Array(eventPasswordHashed)).map(b => b.toString(16).padStart(2, '0')).join('');
process.env.EVENT_CREATION_HASH = eventPasswordHashHex;

// --- Auth admin par session (remplace le hash SHA-256 envoyé à chaque action).
// Le client envoie le SHA-256 du mot de passe partagé du bureau ; en cas de
// correspondance, on émet un JWT de session { admin: true } que les routes
// d'administration exigent ensuite via authenticateAdmin.
app.post("/api/login", (req, res) => {
  const { hash } = req.body;
  if (!hash || hash !== process.env.EVENT_CREATION_HASH) {
    res.status(401).json({ success: false, message: "Mot de passe incorrect" });
    return;
  }
  const token = jsonwebtoken.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: "30d" });
  res.json({ success: true, token });
});

const authenticateAdmin = (req, res, next) => {
  try {
    const decoded = jsonwebtoken.verify(req.headers.authorization || "", process.env.JWT_SECRET);
    if (decoded && decoded.admin) { req.admin = true; return next(); }
  } catch (_) { /* token absent/invalide/expiré */ }
  res.status(401).json({ success: false, message: "Accès admin requis. Merci de te connecter." });
};

app.post("/api/createevent", authenticateAdmin, async (req, res) => {
  const { name, location, participants, description } = req.body;

  const date = new Date(req.body.date);
  const paps = new Date(req.body.paps);
  const id = await generateTableId(schema.events);

  await db
    .insert(schema.events)
    .values({ id, name, date, paps, location, participants, description });
  res.status(201).json({ success: true, id });
});

app.post("/api/editevent", authenticateAdmin, async (req, res) => {
  const { id, name, location, participants, description, users } = req.body;
  const date = new Date(req.body.date);
  const paps = new Date(req.body.paps);
  if (!id) {
    res.status(400).json({ success: false, message: "ID manquant" });
    return;
  }
  const event = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .then(r => r[0]);
  if (!event) {
    res.status(404).json({ success: false, message: "Événement introuvable" });
    return;
  }
  await db
    .update(schema.events)
    .set({ name, date, paps, location, participants, description })
    .where(eq(schema.events.id, id));
  // delete all paps for this event
  const eventUsers = await getEventUsers(id);
  const pxxs = eventUsers.map(user => user.pxx);
  for (const pxx of pxxs) {
    if (!users.includes(pxx)) {
      await db
        .delete(schema.paps)
        .where(and(eq(schema.paps.eid, id), eq(schema.paps.pxx, pxx)))
    }
  }
  for (const pxx of users) {
    if (!pxxs.includes(pxx)) {
      await db
        .insert(schema.paps)
        .values({ eid: id, pxx, date: new Date() });
      await db
        .insert(schema.hpaps)
        .values({ eid: id, pxx, date: new Date() });
    }
  }
  res.status(200).json({ success: true, id });
});

app.post("/api/closeevent", authenticateAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) {
    res.status(400).json({ success: false, message: "ID manquant" });
    return;
  }
  const event = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .then(r => r[0]);
  if (!event) {
    res.status(404).json({ success: false, message: "Événement introuvable" });
    return;
  }
  try {
    await closeEvent({ id });
    res.status(200).json({ success: true, id });
  } catch(err) {
    res.status(500).send(err.toString())
  }
});

app.post("/api/removeevent", authenticateAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) {
    res.status(400).json({ success: false, message: "ID manquant" });
    return;
  }
  await db
    .delete(schema.paps)
    .where(eq(schema.paps.eid, id));
  await db
    .delete(schema.events)
    .where(eq(schema.events.id, id));
  res.status(200).json({ success: true });
});

async function getEventUsers(id) {
  const users = await db
    .select()
    .from(schema.paps)
    .where(eq(schema.paps.eid, id))
    .orderBy(schema.paps.date);

  // Fenêtre prioritaire de 24 h à partir de l'ouverture de l'équi-PAPS (paps).
  const ev = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .then(r => r[0]);
  const deadline = ev ? new Date(new Date(ev.paps).getTime() + 24 * 60 * 60 * 1000) : new Date(0);

  var possibleUsers = {};
  for (const user of users) {
    if (possibleUsers[user.pxx] === undefined) {
      const r = rosterByPxx.get(user.pxx);
      possibleUsers[user.pxx] = {
        sortiesEffectuees: await db
          .select()
          .from(schema.resultats)
          .where(eq(schema.resultats.pxx, user.pxx))
          .then(r => r.length),
        cotisant: r?.cotisant || false,
        prenom: r?.prenom || null,
        nom: r?.nom || null,
        promo: r?.promo || null,
        date: new Date(user.date)
      }
    }
  }

  // Tri par les règles verrouillées (fonction pure, cf. api/lib/draw.js).
  const list = Object.keys(possibleUsers).map(pxx => ({ pxx, ...possibleUsers[pxx] }));
  return rankRegistrants(list, deadline);
}

async function fetchEvent(id) {
  const event = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .then(r => r[0]);

  if (!event) return null;
  
  event.users = await getEventUsers(id);
  return event;
}

app.post("/api/openevent", authenticateAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) {
    res.status(400).json({ success: false, message: "ID manquant" });
    return;
  }
  const event = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .then(r => r[0]);
  if (!event) {
    res.status(404).json({ success: false, message: "Événement introuvable" });
    return;
  }
  try {
    await db.update(schema.events).set({ closed: false }).where(eq(schema.events.id, id));
    res.status(200).json({ success: true, id });
  } catch(err) {
    res.status(500).send(err.toString());
  }
});

async function closeEvent(event) {

  const closed = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, event.id))
    .then(r => r[0]?.closed);
  if (closed) return;

  // On ne fige QUE les gagnants (les N premières places) : chaque place obtenue
  // incrémente le compteur d'événements (sortie = atelier = 1 événement). La
  // liste d'attente au-delà de N n'est pas comptée comme un événement suivi.
  const evRow = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, event.id))
    .then(r => r[0]);
  const users = await getEventUsers(event.id);
  const winners = users.slice(0, evRow?.participants ?? 0);

  if (winners.length > 0) {
    await db
      .insert(schema.resultats)
      .values(winners.map(user => ({ eid: event.id, pxx: user.pxx })));
  }

  await db
    .update(schema.events)
    .set({ closed: true })
    .where(eq(schema.events.id, event.id));
}

async function actualizeResults(req, res, next) {
  const events = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.closed, false))
    .orderBy(schema.events.date);

  for (const event of events) {
    if (new Date() > new Date(event.date)) {
      console.log("Closing event:", event)
      await closeEvent(event);
    }
  }

  next();
}

const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization;
  if (token) {
    const decoded = jsonwebtoken.verify(req.headers.authorization, process.env.JWT_SECRET);
    if (decoded == null || decoded.uid == null) {
      res.status(401).send("Requête invalide, merci de rafraîchir la page.");
      return;
    }
    req.user = decoded;
    next();
  } else {
    res.status(401).send("Requête invalide, merci de rafraîchir la page.");
  }
};

app.get("/api/events", actualizeResults, async (req, res) => {
  const events = await db
    .select()
    .from(schema.events)
    .orderBy(schema.events.date)
    // .where(gte(schema.events.date, new Date()));
  
  for (const event of events) {
    var users = (await fetchEvent(event.id)).users || [];
    event.places = event.participants - users.length;
  }

  res.json(events);
});

app.get("/api/event/:id", actualizeResults, async (req, res) => {
  const id = req.params.id;
  const event = await fetchEvent(id);

  if (!event) {
    res.status(404).json({ success: false, message: "Événement introuvable" });
    return;
  }

  var uid;

  const token = req.headers.authorization;

  if (token && token != "null") {
    try {
      const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);
      if (decoded != null && decoded.uid != null) {
        const existing = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, decoded.uid));
        if (existing.length > 0) uid = decoded.uid;
      }
    } catch(err) {}
  }

  if (!uid) {
    uid = await generateTableId(schema.users);
    await db
      .insert(schema.users)
      .values({ id: uid });
    event.token = jsonwebtoken.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '7d' });
  }

  res.status(200).json(event);
});

// Recherche floue par nom sur le roster (même approche que Pain de Mine).
// Surface PUBLIQUE : ne renvoie que ce qu'il faut pour choisir et lever les
// homonymes (nom + login + promo), jamais l'email ni le téléphone (RGPD).
app.get("/api/roster/search", (req, res) => {
  const q = normSearch(req.query.q || "");
  if (q.length < 2) return res.json([]);
  const out = [];
  for (const r of roster) {
    if (!r.search_key) continue;
    const first = r.search_key.split(" ")[0];
    // clause principale : le nom complet contient la requête ; clause de repli
    // (requête plus longue que le prénom) bornée à >=3 car. pour éviter les
    // faux positifs sur des prénoms courts (« ad » ⊂ « spada »).
    if (r.search_key.includes(q) || (first.length >= 3 && q.includes(first))) {
      out.push({ prenom: r.prenom, nom: r.nom, pxx: r.pxx, promo: r.promo });
      if (out.length >= 40) break;
    }
  }
  res.json(out.slice(0, 8));
});

app.post("/api/paps", authenticateJWT, async (req, res) => {
  const { eid, pxx } = req.body;
  const date = new Date();

  if (req.user == null || req.user.uid == null) {
    res.status(401).send("Requête invalide, merci de rafraîchir la page.");
    return;
  }

  const eventRaw = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eid))
    .then(r => r[0]);

  if (!eventRaw) {
    res.status(404).json({ success: false, message: "Événement introuvable" });
    return;
  }

  if (new Date(eventRaw.paps) > date || eventRaw.closed) {
    res.status(400).json({ success: false, message: "Le PAPS n'est pas ouvert" });
    return;
  }

  if (!rosterByPxx.has(pxx)) {
    res.status(400).json({ success: false, message: "Mineur inconnu" });
    return;
  }

  // Idempotence : re-papser la même personne pour le même événement ne crée
  // rien (avant : des rangées dupliquées silencieuses).
  const already = await db
    .select()
    .from(schema.paps)
    .where(and(eq(schema.paps.eid, eid), eq(schema.paps.pxx, pxx)))
    .then(r => r[0]);
  if (already) {
    res.status(200).json(await fetchEvent(eid));
    return;
  }

  const storedPxx = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, req.user.uid))
    .then(r => r[0]?.pxx);

  if (storedPxx && storedPxx !== pxx) {
    res.status(400).json({ success: false, message: "Merci de ne pas papser pour plus d'une personne." });
    return;
  }

  if (storedPxx == null) {
    await db
      .update(schema.users)
      .set({ pxx })
      .where(eq(schema.users.id, req.user.uid));
  }

  await db
    .insert(schema.paps)
    .values({ eid, pxx, date });

  await db
    .insert(schema.hpaps)
    .values({ eid, pxx, date });

  const event = await fetchEvent(eid);
  if (!event) {
    res.status(404).json({ success: false, message: "Événement introuvable" });
    return;
  }

  res.status(201).json(event);
});

// --- Administration du roster & des cotisants (tout derrière authenticateAdmin) ---

// Import HelloAsso (multipart, champ "csv") : mode dry -> rapport sans écriture ;
// mode apply -> UNE transaction (reset+set+rangées persistantes des non-résolus,
// cf. api/lib/cotisants.js) puis rechargement du cache.
app.post("/api/admin/cotisants/import", authenticateAdmin, upload.single("csv"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Aucun fichier reçu." });
      return;
    }
    const mode = req.body.mode === "apply" ? "apply" : "dry";
    let cotisants;
    try {
      cotisants = loadCotisantsFromText(req.file.buffer.toString("utf-8"));
    } catch (err) {
      res.status(400).json({ success: false, message: "Fichier illisible : " + err.message });
      return;
    }
    if (!cotisants.length) {
      res.status(400).json({ success: false, message: "Aucun cotisant « Cotisation BDA » trouvé. Vérifie que c'est bien l'export HelloAsso complet." });
      return;
    }
    const rosterRows = await db.select().from(schema.roster);
    const report = reconcile(cotisants, rosterRows);
    if (mode === "dry") {
      res.json({ success: true, mode, report });
      return;
    }

    const phantomRows = buildPhantomRows(report.unresolved, rosterRows.map(r => r.pxx));
    const conn = await pool.getConnection();
    let cotisantsCount;
    try {
      await conn.beginTransaction();
      cotisantsCount = await applyReconciliation(conn, report, phantomRows);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    await reloadRoster();
    res.json({ success: true, mode, report, phantoms: phantomRows.length, cotisants: cotisantsCount });
  } catch (err) {
    console.error("[import cotisants]", err);
    res.status(500).json({ success: false, message: "Erreur pendant l'import." });
  }
});

// Table roster côté bureau (paginée, filtrable). Le cache mémoire suffit
// (~3800 rangées) ; les emails restent côté admin, jamais publics.
app.get("/api/admin/roster", authenticateAdmin, (req, res) => {
  const q = normSearch(String(req.query.q || ""));
  const filter = String(req.query.filter || "all");
  const PAGE = 50;
  let rows = roster;
  if (filter === "cotisants") rows = rows.filter(r => r.cotisant);
  if (filter === "pending") rows = rows.filter(r => !r.search_key && (r.source_id === "helloasso" || r.source_id === "ext"));
  if (q) {
    rows = rows.filter(r =>
      (r.search_key || "").includes(q) ||
      normSearch(`${r.prenom || ""} ${r.nom || ""}`).includes(q) ||
      (r.pxx || "").includes(q)
    );
  }
  rows = [...rows].sort((a, b) => (a.nom || "").localeCompare(b.nom || "") || (a.prenom || "").localeCompare(b.prenom || ""));
  const total = rows.length;
  const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
  const slice = rows.slice((page - 1) * PAGE, page * PAGE).map(r => {
    const out = {
      pxx: r.pxx, prenom: r.prenom, nom: r.nom, email: r.email, promo: r.promo,
      cotisant: r.cotisant, source_id: r.source_id, searchable: !!r.search_key,
    };
    if (!r.search_key && (r.source_id === "helloasso" || r.source_id === "ext")) {
      out.suggestions = suggest({ nom: r.nom, prenom: r.prenom, email: r.email }, roster);
    }
    return out;
  });
  res.json({ rows: slice, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) });
});

// Édition manuelle d'une rangée (jamais le pxx : il porte l'historique du
// tirage). `finalize: true` transforme une entrée « à rattacher » en vraie
// entrée cherchable (lève le marqueur helloasso/ext).
app.post("/api/admin/roster/edit", authenticateAdmin, async (req, res) => {
  const { pxx, prenom, nom, email, promo, cotisant, finalize } = req.body;
  if (!pxx) {
    res.status(400).json({ success: false, message: "pxx manquant" });
    return;
  }
  const row = await db.select().from(schema.roster)
    .where(eq(schema.roster.pxx, pxx)).then(r => r[0]);
  if (!row) {
    res.status(404).json({ success: false, message: "Rangée introuvable" });
    return;
  }
  const patch = {
    prenom: prenom ?? row.prenom,
    nom: nom ?? row.nom,
    email: email ?? row.email,
    promo: promo ?? row.promo,
    cotisant: cotisant === undefined ? row.cotisant : !!cotisant,
  };
  if (finalize && patch.prenom && patch.nom) {
    patch.source_id = null;
    patch.search_key = searchKeyOf(patch.prenom, patch.nom);
  }
  await db.update(schema.roster).set(patch).where(eq(schema.roster.pxx, pxx));
  await reloadRoster();
  res.json({ success: true });
});

// Ajout manuel (hors annuaire : prof, intervenant, élève non synchronisé...).
// Cherchable d'emblée, pxx dérivé unique.
app.post("/api/admin/roster/add", authenticateAdmin, async (req, res) => {
  const { prenom, nom, email, promo, cotisant } = req.body;
  if (!prenom || !nom) {
    res.status(400).json({ success: false, message: "Prénom et nom requis." });
    return;
  }
  const nn = normLogin(nom);
  if (!nn) {
    res.status(400).json({ success: false, message: "Nom invalide." });
    return;
  }
  const pxx = derivePxx(
    { promo: normLogin(promo) || "x", nnom: nn, nprenom: normLogin(prenom) },
    new Set(roster.map(r => r.pxx))
  );
  await db.insert(schema.roster).values({
    pxx, prenom, nom, email: email || null, promo: promo || null, photo_url: null,
    search_key: searchKeyOf(prenom, nom), cotisant: !!cotisant, source_id: null,
  });
  await reloadRoster();
  res.status(201).json({ success: true, pxx });
});

// Rattachement d'une entrée « à rattacher » au vrai pxx : transfère le statut
// cotisant, complète l'email si la cible n'en a pas, supprime la rangée
// éphémère (garde : elle ne doit porter aucun historique de tirage).
app.post("/api/admin/cotisants/attach", authenticateAdmin, async (req, res) => {
  const { fromPxx, toPxx } = req.body;
  if (!fromPxx || !toPxx || fromPxx === toPxx) {
    res.status(400).json({ success: false, message: "fromPxx et toPxx requis" });
    return;
  }
  const from = await db.select().from(schema.roster)
    .where(eq(schema.roster.pxx, fromPxx)).then(r => r[0]);
  if (!from || !["helloasso", "ext"].includes(from.source_id) || from.search_key) {
    res.status(400).json({ success: false, message: "Cette rangée n'est pas une entrée en attente." });
    return;
  }
  const to = await db.select().from(schema.roster)
    .where(eq(schema.roster.pxx, toPxx)).then(r => r[0]);
  if (!to) {
    res.status(404).json({ success: false, message: "Rangée cible introuvable." });
    return;
  }
  const papsHist = await db.select().from(schema.paps).where(eq(schema.paps.pxx, fromPxx)).then(r => r.length);
  const resHist = await db.select().from(schema.resultats).where(eq(schema.resultats.pxx, fromPxx)).then(r => r.length);
  if (papsHist > 0 || resHist > 0) {
    res.status(400).json({ success: false, message: "Cette entrée porte un historique de tirage : corrige-la par une édition manuelle plutôt." });
    return;
  }
  await db.update(schema.roster)
    .set({ cotisant: true, email: to.email || from.email })
    .where(eq(schema.roster.pxx, toPxx));
  await db.delete(schema.roster).where(eq(schema.roster.pxx, fromPxx));
  await reloadRoster();
  res.json({ success: true });
});

// --- Clé API du portail des élèves + sync automatique de la base élèves ---
// La clé (créée sur le portail par un élève 2A+, onglet « Clé API ») est
// DÉPOSÉE ici par le bureau (write-only : stockée en base, jamais renvoyée en
// clair). Elle permet au serveur equipaps de tirer l'annuaire du portail sans
// SSH ni scrape Selenium.
const PORTAIL_ANNUAIRE_URL = process.env.PORTAIL_ANNUAIRE_URL || "https://eleves.rezal-mdm.com/api/annuaire/liste";
const PORTAIL_UPLOAD_BASE = process.env.PORTAIL_UPLOAD_BASE || "https://eleves.rezal-mdm.com/upload";
const CLE_PARAM_PORTAIL = "portail_api_key";

app.get("/api/admin/portail/key", authenticateAdmin, async (req, res) => {
  const row = await db.select().from(schema.parametres)
    .where(eq(schema.parametres.cle, CLE_PARAM_PORTAIL)).then(r => r[0]);
  res.json({
    definie: !!row,
    dernier4: row ? row.valeur.slice(-4) : null,
    maj_at: row ? row.maj_at : null,
  });
});

app.post("/api/admin/portail/key", authenticateAdmin, async (req, res) => {
  const cle = String(req.body.cle || "").trim();
  if (!cle.startsWith("pak_") || cle.length < 20 || cle.length > 128) {
    res.status(400).json({ success: false, message: "Clé invalide : elle commence par pak_ et se crée sur le portail (ton profil, onglet Clé API)." });
    return;
  }
  const maj = new Date();
  await db.insert(schema.parametres)
    .values({ cle: CLE_PARAM_PORTAIL, valeur: cle, maj_at: maj })
    .onDuplicateKeyUpdate({ set: { valeur: cle, maj_at: maj } });
  res.json({ success: true, definie: true, dernier4: cle.slice(-4), maj_at: maj });
});

// Synchronise la base élèves depuis l'annuaire du portail. NON destructif :
// pxx, cotisant et historique préservés (même sémantique que l'import annuaire
// PDM, moteur partagé api/lib/students.js).
app.post("/api/admin/roster/sync-portail", authenticateAdmin, async (req, res) => {
  try {
    const row = await db.select().from(schema.parametres)
      .where(eq(schema.parametres.cle, CLE_PARAM_PORTAIL)).then(r => r[0]);
    if (!row) {
      res.status(400).json({ success: false, message: "Aucune clé API du portail déposée : dépose-la d'abord." });
      return;
    }
    const items = [];
    let page = 1, pages = 1;
    do {
      const rep = await fetch(`${PORTAIL_ANNUAIRE_URL}?page=${page}&per_page=1000`, {
        headers: { "X-API-Key": row.valeur },
      });
      if (rep.status === 401 || rep.status === 403) {
        res.status(400).json({ success: false, message: "Clé du portail refusée (invalide, révoquée ou plus 2A+) : redépose une clé valide." });
        return;
      }
      if (!rep.ok) {
        res.status(502).json({ success: false, message: `Portail injoignable (${rep.status}). Réessaie plus tard.` });
        return;
      }
      const j = await rep.json();
      items.push(...j.items);
      pages = j.pages;
      page++;
    } while (page <= pages);

    const students = items.map(it => annuaireToStudent(it, PORTAIL_UPLOAD_BASE));
    const existing = await db.select().from(schema.roster);
    const { updates, inserts } = buildRosterUpsert(students, existing);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await applyRosterUpsert(conn, updates, inserts);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    await reloadRoster();
    const [[{ c }]] = await pool.query("SELECT COUNT(*) c FROM roster");
    res.json({ success: true, rapport: { annuaire: items.length, misAJour: updates.length, nouveaux: inserts.length }, roster: c });
  } catch (err) {
    console.error("[sync-portail]", err);
    res.status(500).json({ success: false, message: "Erreur pendant la synchronisation." });
  }
});

// « Mon nom n'apparaît pas » (élève au moment du PAPS). Identité déclarée,
// NON cherchable (search_key null) tant que le bureau ne l'a pas validée
// (édition avec finalize ou rattachement), et cotisant=0 IMPOSÉ serveur :
// la cotisation ne se déclare jamais, elle se détecte par réconciliation.
app.post("/api/roster/external", async (req, res) => {
  const prenom = String(req.body.prenom || "").trim();
  const nom = String(req.body.nom || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const promo = String(req.body.promo || "").trim();
  if (!prenom || !nom) {
    res.status(400).json({ success: false, message: "Prénom et nom requis." });
    return;
  }
  if (prenom.length > 128 || nom.length > 128 || email.length > 255 || promo.length > 8) {
    res.status(400).json({ success: false, message: "Données trop longues." });
    return;
  }
  const nn = normLogin(nom);
  if (!nn) {
    res.status(400).json({ success: false, message: "Nom invalide." });
    return;
  }
  // dédoublonnage : même personne signalée deux fois -> la même rangée
  const dup = roster.find(r =>
    r.source_id === "ext" && !r.search_key &&
    normLogin(r.nom) === nn && normLogin(r.prenom) === normLogin(prenom)
  );
  if (dup) {
    res.json({ success: true, pxx: dup.pxx });
    return;
  }
  const used = new Set(roster.map(r => r.pxx));
  let pxx = ("x" + nn).slice(0, 10), n = 0;
  while (used.has(pxx)) {
    const suffix = String(++n);
    pxx = ("x" + nn.slice(0, 9 - suffix.length) + suffix).slice(0, 10);
  }
  await db.insert(schema.roster).values({
    pxx, prenom, nom, email: email || null, promo: promo || null, photo_url: null,
    search_key: null, cotisant: false, source_id: "ext",
  });
  await reloadRoster();
  res.status(201).json({ success: true, pxx });
});

// Monitoring admin : chiffres agrégés pour le tableau de bord.
app.get("/api/admin/summary", authenticateAdmin, async (req, res) => {
  const events = await db.select().from(schema.events);
  const inscriptions = (await db.select().from(schema.paps)).length;
  res.json({
    events: events.length,
    openEvents: events.filter(e => !e.closed).length,
    inscriptions,
    cotisants: roster.filter(r => r.cotisant).length,
    roster: roster.length,
    pending: roster.filter(r => !r.search_key && (r.source_id === "helloasso" || r.source_id === "ext")).length,
  });
});

const PORT = process.env.PORT_API || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
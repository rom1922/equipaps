import express from "express";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./db/schema.js";
import dotenv from "dotenv";
import { and, eq, gte } from "drizzle-orm";
import jsonwebtoken from "jsonwebtoken";
import { normSearch } from "./lib/normalize.js";

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
// mineurs.json, cf. api/scripts/sync-roster.js). Remplace users.txt. L'identité
// reste le login portail `pxx`. Chargée en mémoire au boot (comme l'ancien
// users.txt) ; après un re-sync, on redémarre le service pour la recharger.
async function loadRoster() {
  try {
    return await db.select().from(schema.roster);
  } catch (err) {
    console.error("roster indisponible (table absente ? lancer sync-roster) :", err.message);
    return [];
  }
}
let roster = await loadRoster();
let rosterByPxx = new Map(roster.map(r => [r.pxx, r]));
console.log(`roster chargé : ${roster.length} élèves (${roster.filter(r => r.search_key).length} recherchables)`);

const eventPasswordHashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(process.env.EVENT_PASSWORD || ""));
const eventPasswordHashHex = Array.from(new Uint8Array(eventPasswordHashed)).map(b => b.toString(16).padStart(2, '0')).join('');
process.env.EVENT_CREATION_HASH = eventPasswordHashHex;

app.post("/api/createevent", async (req, res) => {
  const { name, location, participants, description, hash } = req.body;
  if (hash !== process.env.EVENT_CREATION_HASH) {
    res.status(403).json({ success: false, message: "Mauvais mot de passe" });
    return;
  }

  const date = new Date(req.body.date);
  const paps = new Date(req.body.paps);
  const id = await generateTableId(schema.events);

  await db
    .insert(schema.events)
    .values({ id, name, date, paps, location, participants, description });
  res.status(201).json({ success: true, id });
});

app.post("/api/editevent", async (req, res) => {
  const { id, name, location, participants, description, hash, users } = req.body;
  if (hash !== process.env.EVENT_CREATION_HASH) {
    res.status(403).json({ success: false, message: "Mauvais mot de passe" });
    return;
  }
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

app.post("/api/closeevent", async (req, res) => {
  const { id, hash } = req.body;
  if (hash !== process.env.EVENT_CREATION_HASH) {
    res.status(403).json({ success: false, message: "Mauvais mot de passe" });
    return;
  }
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

app.post("/api/removeevent", async (req, res) => {
  const { id, hash } = req.body;
  if (hash !== process.env.EVENT_CREATION_HASH) {
    res.status(403).json({ success: false, message: "Mauvais mot de passe" });
    return;
  }
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

  var possibleUsers = {};
  for (const user of users) {
    if (possibleUsers[user.pxx] === undefined) {
      possibleUsers[user.pxx] = {
        sortiesEffectuees: await db
          .select()
          .from(schema.resultats)
          .where(eq(schema.resultats.pxx, user.pxx))
          .then(r => r.length),
        cotisant: rosterByPxx.get(user.pxx)?.cotisant || false,
        date: new Date(user.date)
      }
    }
  }

  const order = Object.keys(possibleUsers).sort((a, b) => {
    // cotisants first
    if (possibleUsers[a].cotisant && !possibleUsers[b].cotisant) return -1;
    if (!possibleUsers[a].cotisant && possibleUsers[b].cotisant) return 1;
    // then by sortiesEffectuees ascending
    if (possibleUsers[a].sortiesEffectuees < possibleUsers[b].sortiesEffectuees) return -1;
    if (possibleUsers[a].sortiesEffectuees > possibleUsers[b].sortiesEffectuees) return 1;
    // then by date ascending
    if (possibleUsers[a].date < possibleUsers[b].date) return -1;
    if (possibleUsers[a].date > possibleUsers[b].date) return 1;
  });

  return order.map(user => ({pxx: user, ...possibleUsers[user]}))
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

async function closeEvent(event) {

  const closed = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, event.id))
    .then(r => r[0]?.closed);
  if (closed) return;

  const users = await getEventUsers(event.id);

  if (users.length > 0) {
    await db
      .insert(schema.resultats)
      .values(users.map(user => ({ eid: event.id, pxx: user.pxx })));
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
    if (r.search_key.includes(q) || q.includes(r.search_key.split(" ")[0])) {
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

  if (eventRaw.paps > date || eventRaw.closed) {
    res.status(400).json({ success: false, message: "Le PAPS n'est pas ouvert" });
    return;
  }

  if (!rosterByPxx.has(pxx)) {
    res.status(400).json({ success: false, message: "Mineur inconnu" });
    return;
  }

  if (!eventRaw) {
    res.status(404).json({ success: false, message: "Événement introuvable" });
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

const PORT = process.env.PORT_API || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
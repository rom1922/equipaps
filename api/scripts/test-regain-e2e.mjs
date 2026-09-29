// Test end-to-end du cycle PERTE puis REGAIN entre tirages simultanés (2026-09-29),
// contre l'API LIVE + la base réelle. Le scénario décrit par Vicente :
//   1. Alice (0 atelier, 2 sorties obtenues) s'inscrit à dessin (h1) puis théâtre (h2).
//      Elle est provisoirement retenue à dessin -> sa place en attente pèse au théâtre.
//   2. Charlie (0 atelier, non cotisant) rejoint théâtre (h4) : moins servi qu'Alice
//      (1 en attente), il la devance.
//   3. Bob (0 atelier, COTISANT) rejoint dessin (h3) : à égalité de compteur le
//      cotisant passe devant -> Alice PERD dessin.
//   4. Alice n'a plus de place en attente -> au théâtre elle redevient fraîche (0),
//      son inscription (h2) précède celle de Charlie (h4) : elle REGAGNE la place.
//   5. Isolation de type : les 2 SORTIES d'Alice ne pèsent JAMAIS sur les tirages
//      d'ateliers (compteur affiché = ateliers seulement, 0).
// Crée un scénario contrôlé, lit les classements via GET /api/event/:id, vérifie,
// puis NETTOIE tout. À lancer sur Euterpe, depuis /home/rezal/equipaps :
//   node api/scripts/test-regain-e2e.mjs
import "dotenv/config";
import mysql from "mysql2/promise";

const API = `http://localhost:${process.env.PORT_API || 8094}`;
const gid = () => Array.from({ length: 16 }, () =>
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");

const T0 = new Date("2026-09-01T12:00:00Z");      // ouverture (paps) des deux événements
const h = (n) => new Date(T0.getTime() + n * 3600 * 1000);
const FUTURE = new Date("2026-12-01T12:00:00Z");  // date event future -> pas d'auto-clôture

let failures = 0;
const check = (label, cond, got) => {
  console.log(`${cond ? "  ok " : "  FAIL "} ${label}${cond ? "" : `  (obtenu: ${JSON.stringify(got)})`}`);
  if (!cond) failures++;
};

const pool = await mysql.createPool({
  host: process.env.DB_MYSQL_HOST, user: process.env.DB_MYSQL_USER,
  database: process.env.DB_MYSQL_DATABASE, password: process.env.DB_MYSQL_PASSWORD,
});

async function cleanupByName() {
  const [rows] = await pool.query("SELECT id FROM events WHERE name LIKE 'E2E-REGAIN-TEST%'");
  for (const r of rows) {
    await pool.query("DELETE FROM paps WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM hpaps WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM resultats WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM events WHERE id=?", [r.id]);
  }
}

const classement = async (id) =>
  (await (await fetch(`${API}/api/event/${id}`)).json()).users || [];

async function main() {
  await cleanupByName();

  // Le référentiel de comptage (comptage_depuis) exclut les événements
  // antérieurs : l'historique du test doit vivre APRÈS la borne.
  let past = new Date("2026-08-01T12:00:00Z");
  try {
    const [rows] = await pool.query("SELECT valeur FROM parametres WHERE cle='comptage_depuis'");
    if (rows.length && rows[0].valeur) {
      const borne = new Date(rows[0].valeur);
      if (!Number.isNaN(borne.getTime()) && borne > past) past = new Date(borne.getTime() + 3600 * 1000);
    }
  } catch { /* table parametres absente : tout l'historique compte */ }
  const PAST = past;

  // Alice et Charlie : non cotisants, 0 atelier. Bob : cotisant, 0 atelier.
  const [cot] = await pool.query(
    "SELECT pxx FROM roster WHERE cotisant=1 AND search_key IS NOT NULL LIMIT 1");
  const [non] = await pool.query(
    "SELECT pxx FROM roster WHERE cotisant=0 AND search_key IS NOT NULL LIMIT 2");
  if (cot.length < 1 || non.length < 2) { console.log("Pas assez d'élèves pour le test."); process.exit(1); }
  const alice = non[0].pxx, charlie = non[1].pxx, bob = cot[0].pxx;

  // Historique clos : 2 sorties obtenues par Alice (ne pèsent PAS sur les ateliers).
  const hS1 = gid(), hS2 = gid();
  for (const id of [hS1, hS2]) {
    await pool.query(
      "INSERT INTO events (id,name,date,paps,location,participants,closed,type) VALUES (?,?,?,?,?,?,1,'sortie')",
      [id, "E2E-REGAIN-TEST-hist", PAST, PAST, "test", 10]);
    await pool.query("INSERT INTO resultats (eid,pxx) VALUES (?,?)", [id, alice]);
  }

  // Deux ateliers ouverts, PAPS à la même heure, 1 place chacun.
  const eD = gid(), eT = gid();
  for (const [id, name] of [[eD, "E2E-REGAIN-TEST-dessin"], [eT, "E2E-REGAIN-TEST-theatre"]]) {
    await pool.query(
      "INSERT INTO events (id,name,date,paps,location,participants,closed,type) VALUES (?,?,?,?,?,?,0,'atelier')",
      [id, name, FUTURE, T0, "test", 1]);
  }
  const addPaps = (eid, pxx, when) =>
    pool.query("INSERT INTO paps (eid,pxx,date) VALUES (?,?,?)", [eid, pxx, when]);

  // --- Étape 1 : Alice s'inscrit à dessin (h1) puis théâtre (h2). ---
  await addPaps(eD, alice, h(1));
  await addPaps(eT, alice, h(2));
  let d = await classement(eD);
  check("dessin : Alice provisoirement retenue, compteur affiché 0 atelier (ses 2 sorties ne pèsent pas)",
    d[0]?.pxx === alice && d[0]?.obtentions === 0 && !d[0]?.enAttente, d[0]);
  let t = await classement(eT);
  check("théâtre : Alice porte sa place dessin en attente (enAttente=1)",
    t[0]?.pxx === alice && t[0]?.enAttente === 1, t[0]);

  // --- Étape 2 : Charlie (0, non cotisant) rejoint théâtre (h4) : il est
  //     frais, Alice compte 1 (en attente) -> il la devance. ---
  await addPaps(eT, charlie, h(4));
  t = await classement(eT);
  check("théâtre : Charlie (frais) devant Alice (place dessin en attente)",
    t[0]?.pxx === charlie && t[1]?.pxx === alice && t[1]?.enAttente === 1, t);

  // --- Étape 3 : Bob (0, COTISANT) rejoint dessin (h3) : à égalité 0 = 0,
  //     le cotisant passe devant -> Alice PERD dessin (1 seule place). ---
  await addPaps(eD, bob, h(3));
  d = await classement(eD);
  check("dessin : Bob (cotisant à égalité) prend la place -> Alice perd dessin",
    d[0]?.pxx === bob && d[1]?.pxx === alice, d);

  // --- Étape 4 : plus de place en attente -> au théâtre Alice redevient
  //     fraîche (0 effectif) et son inscription h2 précède Charlie h4 :
  //     elle REGAGNE la place. Cycle perte/regain cohérent, en direct. ---
  t = await classement(eT);
  check("théâtre : Alice n'a plus de pendance (enAttente absent)",
    t.find(u => u.pxx === alice)?.enAttente === undefined, t);
  check("théâtre : Alice (0, h2) repasse devant Charlie (0, h4) -> place regagnée",
    t[0]?.pxx === alice && t[1]?.pxx === charlie, t);

  await cleanupByName();
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM events WHERE name LIKE 'E2E-REGAIN-TEST%'");
  check("nettoyage complet (0 artefact de test restant)", n === 0, n);

  await pool.end();
  console.log(failures === 0 ? "\n==> E2E REGAIN : PASS" : `\n==> E2E REGAIN : ${failures} ECHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

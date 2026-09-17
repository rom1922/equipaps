// Test end-to-end du moteur de tirage contre l'API LIVE + la base réelle.
// Crée un scénario contrôlé, lit le classement via GET /api/event/:id, clôture
// via POST /api/closeevent (session admin), vérifie les gagnants, puis NETTOIE
// tout. À lancer sur Euterpe : node --env-file=.env api/scripts/test-draw-e2e.mjs
import mysql from "mysql2/promise";
import crypto from "node:crypto";

const API = `http://localhost:${process.env.PORT_API || 3000}`;
const gid = () => Array.from({ length: 16 }, () =>
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");

const T0 = new Date("2026-09-01T12:00:00Z");      // ouverture (paps)
const h = (n) => new Date(T0.getTime() + n * 3600 * 1000);
const FUTURE = new Date("2026-12-01T12:00:00Z");   // date event future -> pas d'auto-clôture
const PAST = new Date("2026-08-01T12:00:00Z");

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
  const [rows] = await pool.query("SELECT id FROM events WHERE name LIKE 'E2E-DRAW-TEST%'");
  for (const r of rows) {
    await pool.query("DELETE FROM paps WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM hpaps WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM resultats WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM events WHERE id=?", [r.id]);
  }
}

async function main() {
  await cleanupByName();

  // Cinq élèves réels : 2 cotisants, 3 non-cotisants.
  const [cot] = await pool.query("SELECT pxx FROM roster WHERE cotisant=1 AND search_key IS NOT NULL LIMIT 2");
  const [non] = await pool.query("SELECT pxx FROM roster WHERE cotisant=0 AND search_key IS NOT NULL LIMIT 3");
  if (cot.length < 2 || non.length < 3) { console.log("Pas assez d'élèves pour le test."); process.exit(1); }
  const s3 = cot[0].pxx, s4 = cot[1].pxx;          // cotisants
  const s1 = non[0].pxx, s2 = non[1].pxx, s5 = non[2].pxx;  // non-cotisants

  const eHist = gid(), eDraw = gid();
  // Événement d'historique (clos) pour donner des "sorties" ; event de tirage.
  await pool.query("INSERT INTO events (id,name,date,paps,location,participants,closed) VALUES (?,?,?,?,?,?,1)",
    [eHist, "E2E-DRAW-TEST-hist", PAST, PAST, "test", 10]);
  await pool.query("INSERT INTO events (id,name,date,paps,location,participants,closed) VALUES (?,?,?,?,?,?,0)",
    [eDraw, "E2E-DRAW-TEST-draw", FUTURE, T0, "test", 2]);

  // Sorties déjà obtenues : s1 -> 2, s5 -> 5, les autres 0.
  const addSorties = async (pxx, n) => {
    for (let i = 0; i < n; i++) await pool.query("INSERT INTO resultats (eid,pxx) VALUES (?,?)", [eHist, pxx]);
  };
  await addSorties(s1, 2);
  await addSorties(s5, 5);

  // Inscriptions au tirage (dates contrôlées : deadline = T0+24h).
  const addPaps = async (pxx, when) => pool.query("INSERT INTO paps (eid,pxx,date) VALUES (?,?,?)", [eDraw, pxx, when]);
  await addPaps(s1, h(1));    // prioritaire, 2 sorties
  await addPaps(s2, h(2));    // prioritaire, 0 sortie
  await addPaps(s3, h(3));    // prioritaire, 0 sortie, cotisant
  await addPaps(s5, h(26));   // tardif, 5 sorties
  await addPaps(s4, h(30));   // tardif, 0 sortie, cotisant

  // 1) Classement via l'API live.
  const ev = await (await fetch(`${API}/api/event/${eDraw}`)).json();
  const order = (ev.users || []).map(u => u.pxx);
  const expected = [s3, s2, s1, s5, s4];
  check("classement = [s3(prio,cot,0), s2(prio,0), s1(prio,2), s5(tardif), s4(tardif)]",
    JSON.stringify(order) === JSON.stringify(expected), order);
  check("gagnants (2 premiers) = s3, s2",
    order[0] === s3 && order[1] === s2, order.slice(0, 2));

  // 2) Clôture via l'endpoint admin -> resultats ne doit contenir QUE les 2 gagnants.
  const hash = crypto.createHash("sha256").update(process.env.EVENT_PASSWORD || "").digest("hex");
  const login = await (await fetch(`${API}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash }) })).json();
  check("login admin OK", !!login.token, login);
  const close = await fetch(`${API}/api/closeevent`, {
    method: "POST", headers: { "Content-Type": "application/json", authorization: login.token },
    body: JSON.stringify({ id: eDraw }) });
  check("closeevent 200", close.status === 200, close.status);

  const [res] = await pool.query("SELECT pxx FROM resultats WHERE eid=? ORDER BY id", [eDraw]);
  const winners = res.map(r => r.pxx).sort();
  check("resultats = SEULEMENT les 2 gagnants (pas la liste d'attente)",
    JSON.stringify(winners) === JSON.stringify([s2, s3].sort()), res.map(r => r.pxx));

  await cleanupByName();
  const [[{ c }]] = await pool.query("SELECT COUNT(*) c FROM events WHERE name LIKE 'E2E-DRAW-TEST%'");
  check("nettoyage complet (0 artefact de test restant)", c === 0, c);

  await pool.end();
  console.log(failures === 0 ? "\n==> E2E TIRAGE : PASS" : `\n==> E2E TIRAGE : ${failures} ECHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

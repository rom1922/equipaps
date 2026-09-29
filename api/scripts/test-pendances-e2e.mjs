// Test end-to-end des tirages SIMULTANÉS (places en attente, 2026-09-29) contre
// l'API LIVE + la base réelle. Deux événements ouverts du même type, PAPS ouverts
// à la même heure : une personne inscrite aux deux ne doit pas rafler les deux
// places en comptant pour zéro — sa place en attente ailleurs pèse comme une
// obtention, SAUF dans le tirage de sa plus ancienne inscription (protégée).
// Crée un scénario contrôlé, lit les classements via GET /api/event/:id,
// vérifie, puis NETTOIE tout. À lancer sur Euterpe :
//   node --env-file=.env api/scripts/test-pendances-e2e.mjs
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
  const [rows] = await pool.query("SELECT id FROM events WHERE name LIKE 'E2E-PENDANCES-TEST%'");
  for (const r of rows) {
    await pool.query("DELETE FROM paps WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM hpaps WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM resultats WHERE eid=?", [r.id]);
    await pool.query("DELETE FROM events WHERE id=?", [r.id]);
  }
}

async function main() {
  await cleanupByName();

  // Trois élèves non cotisants, 0 obtention gellée.
  const [non] = await pool.query(
    "SELECT pxx FROM roster WHERE cotisant=0 AND search_key IS NOT NULL LIMIT 3");
  if (non.length < 3) { console.log("Pas assez d'élèves pour le test."); process.exit(1); }
  const a = non[0].pxx, b = non[1].pxx, c = non[2].pxx;

  const eA = gid(), eB = gid();
  // Deux ateliers ouverts, PAPS à la même heure, 1 place chacun.
  for (const [id, name] of [[eA, "E2E-PENDANCES-TEST-A"], [eB, "E2E-PENDANCES-TEST-B"]]) {
    await pool.query(
      "INSERT INTO events (id,name,date,paps,location,participants,closed,type) VALUES (?,?,?,?,?,?,0,'atelier')",
      [id, name, FUTURE, T0, "test", 1]);
  }

  // `a` s'inscrit à A (h1) PUIS à B (h2) : en attente dans A, inscrit plus tard à B.
  // `b` et `c` ne s'inscrivent qu'à B (h3, h4), 0 obtention, non cotisants.
  const addPaps = (eid, pxx, when) =>
    pool.query("INSERT INTO paps (eid,pxx,date) VALUES (?,?,?)", [eid, pxx, when]);
  await addPaps(eA, a, h(1));
  await addPaps(eB, a, h(2));
  await addPaps(eB, b, h(3));
  await addPaps(eB, c, h(4));

  // 1) Classement de A : `a` est seul, sa place en attente est la plus ANCIENNE
  //    (inscrite à A avant B) -> protégée, pas de pénalité : retenu, enAttente 0.
  const evA = await (await fetch(`${API}/api/event/${eA}`)).json();
  const uA = (evA.users || []).find(u => u.pxx === a);
  check("A : `a` en tête, sans pénalité (sa plus ancienne inscription est protégée)",
    evA.users?.[0]?.pxx === a && !uA?.enAttente, { users: evA.users });

  // 2) Classement de B : `a` détient une place en attente dans A (inscription
  //    PLUS ANCIENNE que la sienne à B) -> compte 1 : `b` et `c` (0 effectif)
  //    passent devant. L'ordre de `b`/`c` suit l'ordre d'inscription.
  const evB = await (await fetch(`${API}/api/event/${eB}`)).json();
  const orderB = (evB.users || []).map(u => u.pxx);
  check("B : ordre = [b, c, a] — la place en attente de `a` dans A pèse",
    JSON.stringify(orderB) === JSON.stringify([b, c, a]), orderB);
  const uB = (evB.users || []).find(u => u.pxx === a);
  check("B : `a` porte enAttente=1 (affiché « 1 en attente ailleurs »)",
    uB?.enAttente === 1, uB);

  // 3) Le classement de A n'a pas bougé avec l'ajout d'inscrits à B (pas de
  //    oscillation croisée : A reste protégé).
  const evA2 = await (await fetch(`${API}/api/event/${eA}`)).json();
  check("A : `a` toujours retenu après les inscriptions à B (pas d'oscillation)",
    evA2.users?.[0]?.pxx === a, evA2.users);

  await cleanupByName();
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM events WHERE name LIKE 'E2E-PENDANCES-TEST%'");
  check("nettoyage complet (0 artefact de test restant)", n === 0, n);

  await pool.end();
  console.log(failures === 0 ? "\n==> E2E PENDANCES : PASS" : `\n==> E2E PENDANCES : ${failures} ECHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

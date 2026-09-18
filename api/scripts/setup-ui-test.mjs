// Monte (ou nettoie) un événement de démonstration pour vérifier l'UI de la
// liste des inscrits. node --env-file=.env api/scripts/setup-ui-test.mjs [--clean]
import mysql from "mysql2/promise";

const CLEAN = process.argv.includes("--clean");
const EID = "UITESTDEMO000001", EHIST = "UITESTHIST000001";
const pool = await mysql.createPool({
  host: process.env.DB_MYSQL_HOST, user: process.env.DB_MYSQL_USER,
  database: process.env.DB_MYSQL_DATABASE, password: process.env.DB_MYSQL_PASSWORD,
});

async function clean() {
  for (const id of [EID, EHIST]) {
    await pool.query("DELETE FROM paps WHERE eid=?", [id]);
    await pool.query("DELETE FROM hpaps WHERE eid=?", [id]);
    await pool.query("DELETE FROM resultats WHERE eid=?", [id]);
    await pool.query("DELETE FROM events WHERE id=?", [id]);
  }
}

await clean();
if (CLEAN) { console.log("UI test nettoyé."); await pool.end(); process.exit(0); }

const now = Date.now();
const paps = new Date(now - 2 * 3600 * 1000);            // ouvert depuis 2 h
const date = new Date(now + 7 * 24 * 3600 * 1000);       // dans 7 jours
await pool.query("INSERT INTO events (id,name,date,paps,location,participants,closed) VALUES (?,?,?,?,?,?,0)",
  [EID, "Demo affichage PAPS", date, paps, "Salle test", 2]);
await pool.query("INSERT INTO events (id,name,date,paps,location,participants,closed) VALUES (?,?,?,?,?,?,1)",
  [EHIST, "Demo historique", new Date(now - 30 * 24 * 3600 * 1000), new Date(now - 30 * 24 * 3600 * 1000), "x", 10]);

const [cot] = await pool.query("SELECT pxx,prenom,nom FROM roster WHERE cotisant=1 AND search_key IS NOT NULL LIMIT 2");
const [non] = await pool.query("SELECT pxx,prenom,nom FROM roster WHERE cotisant=0 AND search_key IS NOT NULL LIMIT 2");
const A = cot[0], C = cot[1], B = non[0], D = non[1];    // A,C cotisants ; B,D non

// Sorties : C -> 1, D -> 3 (les autres 0).
const addSorties = async (pxx, n) => { for (let i = 0; i < n; i++) await pool.query("INSERT INTO resultats (eid,pxx) VALUES (?,?)", [EHIST, pxx]); };
await addSorties(C.pxx, 1);
await addSorties(D.pxx, 3);

// Inscriptions dans l'ordre A,B,C,D (toutes dans la fenêtre prioritaire).
const addPaps = async (pxx, offMin) => pool.query("INSERT INTO paps (eid,pxx,date) VALUES (?,?,?)", [EID, pxx, new Date(now - (60 - offMin) * 60000)]);
await addPaps(A.pxx, 0);
await addPaps(B.pxx, 5);
await addPaps(C.pxx, 10);
await addPaps(D.pxx, 15);

console.log("Événement démo prêt.");
console.log("URL: https://bda.rezal-mdm.com/event/" + EID);
console.log("Attendu (2 places) : retenus = " + [A, B].map(x => x.prenom + " " + x.nom).join(", ")
  + " ; en attente = " + [C, D].map(x => x.prenom + " " + x.nom).join(", "));
console.log("(A,B = 0 sortie ; A cotisant ; C = 1 sortie ; D = 3 sorties)");
await pool.end();

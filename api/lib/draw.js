// Moteur de tirage (règles verrouillées avec Vicente). Fonction PURE, testable
// sans base de données : elle ordonne les inscrits, les N premiers sont les
// gagnants.
//
// Règles :
//  1. Fenêtre prioritaire de 24 h à partir de l'ouverture (deadline = paps + 24h).
//  2. Inscrits AVANT la deadline = groupe prioritaire, trié par :
//       a. participations déjà obtenues DU MÊME TYPE que l'événement tiré,
//          plus les places EN ATTENTE dans les autres tirages ouverts du même
//          type, croissant (le moins servi devant) ;
//       b. à égalité, le cotisant passe devant ;
//       c. à égalité encore, l'ordre d'inscription (date croissante).
//  3. Inscrits APRÈS la deadline = « vrai PAPS », premier arrivé premier servi,
//     placés derrière tout le groupe prioritaire.
//
// `users` : [{ pxx, obtentions, enAttente?, cotisant, date: Date }]  // obtentions = compteur du type de l'événement, dans le référentiel de comptage courant
// `deadline` : Date (paps + 24 h)
const servis = u => u.obtentions + (u.enAttente || 0);
export function rankRegistrants(users, deadline) {
  return [...users].sort((a, b) => {
    const aLate = a.date > deadline, bLate = b.date > deadline;
    if (aLate !== bLate) return aLate ? 1 : -1;                 // prioritaires avant tardifs
    if (!aLate) {                                               // au sein du groupe prioritaire
      if (servis(a) !== servis(b))
        return servis(a) - servis(b);           // le moins servi devant (obtenu ou en attente)
      if (a.cotisant !== b.cotisant) return a.cotisant ? -1 : 1; // cotisant à égalité
    }
    return a.date - b.date;                                    // ordre d'inscription
  });
}

// Places en attente ailleurs (tirages ouverts simultanés, 2026-09-29) : une
// place actuellement retenue dans un AUTRE événement ouvert du même type pèse
// comme une obtention — sinon deux PAPS ouverts en même temps permettaient de
// rafler les deux en comptant pour zéro. Garde anti-pénalité croisée : seules
// les places en attente dont l'inscription est PLUS ANCIENNE que celle de
// l'événement tiré pénalisent ; la toute première place d'un inscrit (son
// inscription la plus ancienne) reste fraîche dans son propre tirage, il ne
// peut pas les perdre toutes.
// `pendancesParPxx` : Map<pxx, Date[]> — dates d'inscription des places
// actuellement retenues dans les autres tirages ouverts.
export function avecPlacesEnAttente(users, pendancesParPxx) {
  return users.map(u => {
    const anciennes = (pendancesParPxx.get(u.pxx) || [])
      .filter(d => new Date(d) < new Date(u.date));
    return anciennes.length ? { ...u, enAttente: anciennes.length } : u;
  });
}

// Les gagnants : les N premières places après tri.
export function winners(users, deadline, participants) {
  return rankRegistrants(users, deadline).slice(0, participants);
}

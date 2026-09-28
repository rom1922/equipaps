// Moteur de tirage (règles verrouillées avec Vicente). Fonction PURE, testable
// sans base de données : elle ordonne les inscrits, les N premiers sont les
// gagnants.
//
// Règles :
//  1. Fenêtre prioritaire de 24 h à partir de l'ouverture (deadline = paps + 24h).
//  2. Inscrits AVANT la deadline = groupe prioritaire, trié par :
//       a. participations déjà obtenues DU MÊME TYPE que l'événement tiré, croissant (le moins servi devant) ;
//       b. à égalité, le cotisant passe devant ;
//       c. à égalité encore, l'ordre d'inscription (date croissante).
//  3. Inscrits APRÈS la deadline = « vrai PAPS », premier arrivé premier servi,
//     placés derrière tout le groupe prioritaire.
//
// `users` : [{ pxx, obtentions, cotisant, date: Date }]  // obtentions = compteur du type de l'événement, dans le référentiel de comptage courant
// `deadline` : Date (paps + 24 h)
export function rankRegistrants(users, deadline) {
  return [...users].sort((a, b) => {
    const aLate = a.date > deadline, bLate = b.date > deadline;
    if (aLate !== bLate) return aLate ? 1 : -1;                 // prioritaires avant tardifs
    if (!aLate) {                                               // au sein du groupe prioritaire
      if (a.obtentions !== b.obtentions)
        return a.obtentions - b.obtentions;      // le moins servi devant
      if (a.cotisant !== b.cotisant) return a.cotisant ? -1 : 1; // cotisant à égalité
    }
    return a.date - b.date;                                    // ordre d'inscription
  });
}

// Les gagnants : les N premières places après tri.
export function winners(users, deadline, participants) {
  return rankRegistrants(users, deadline).slice(0, participants);
}

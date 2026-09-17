// Normalisations partagées (sync-roster + recherche par nom).
// Deux formes distinctes, chacune fidèle à un usage :

// Login portail « pxx » : minuscules, sans accents, on ne garde que [a-z0-9]
// (espaces, tirets et apostrophes SUPPRIMÉS, pas remplacés).
// Observé sur l'existant : « Baudin de » -> « baudinde », « De Rivière » -> « deriviere ».
export function normLogin(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Clé de recherche floue (même approche que Pain de Mine) : minuscules, sans
// accents, tirets/apostrophes -> espaces (séparateurs de mots), espaces
// multiples réduits. Sert à filtrer « prenom nom » par sous-chaîne.
export function normSearch(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[-'’]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

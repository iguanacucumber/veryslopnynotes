// Clé de regroupement d'une matière : UN SEUL calcul pour tout le web.
//
// Miroir exact de `core/Averages.kt` (`subjectKey`) côté natif : sans accents,
// en minuscules, sans bords. Le regroupement des notes, des moyennes et la
// recherche « maths » s'appuient tous dessus : deux graphies d'une même
// matière (« Mathématiques », « MATHEMATIQUES ») doivent tomber dans la même
// clé, sinon le web affiche deux cartes là où le rapport natif n'en montre
// qu'une.
//
// NFKD, et non NFD : le natif décompose aussi les caractères de compatibilité
// (« ① » -> « 1 », « ﬁ » -> « fi », « Ａ » -> « A »). Les marques
// combinantes (U+0300-U+036F) sont retirées après la décomposition, comme en
// Kotlin.
export function subjectKey(subject: string): string {
  return subject
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

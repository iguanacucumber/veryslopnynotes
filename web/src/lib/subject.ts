// Clé de regroupement d'une matière : un seul calcul pour tout le web, miroir
// exact de `core/Averages.kt` (`subjectKey`) : sans accents, minuscules,
// sans bords. NFKD (et non NFD) comme le Kotlin : les caractères de
// compatibilité sont décomposés, les marques combinantes retirées ensuite.
export function subjectKey(subject: string): string {
  return subject
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

package fr.veryslopnynotes.core

// ENUMS DU CONTRAT -> FRANÇAIS (#147) — LE SEUL TABLEAU.
//
// Le contrat est en anglais (`shared/contracts/models.ts` : `student`, `teacher`,
// `served`, `planned`, `cancelled`, `moved`, `late`, `subject`…), l'interface
// est française. Avant, chaque écran traduisait le sien, ou ne traduisait pas :
// `Kind = TEACHER` en majuscules au milieu d'une phrase française, `SERVING`
// sur un menu, `Statut inconnu` selon l'écran. Cinq tables, donc cinq réponses
// au même jeton.
//
// UN tableau, une fonction. Le repli est EXPLICITE et lisible : un jeton hors
// contrat ne sort JAMAIS en clair (`SERVED`, `TEACHER`, `xyz`) — il devient le
// libellé que l'appelant fournit (« Statut inconnu », « Autre source »), donc
// au pire « Inconnu ». Jamais de majuscules anglaises en sortie.
//
// Les jetons sont rangés par constante du contrat, ce qui rend la couverture
// vérifiable : le miroir TS (`tests/unit/android-echappatoires.test.ts`) liste
// les `export const [...] as const` de `models.ts` / `events.ts` et exige une
// entrée pour chacun. Un enum ajouté au contrat SANS libellé fait donc échouer
// `make check` au lieu d'apparaître en anglais dans une version.
//
// Les libellés sont en casse de phrase (« Servi »). Un appel qui les colle au
// milieu d'une phrase (`« $head • annulé »` côté EDT) les met en minuscules
// explicitement : la table ne peut pas porter les deux, et la casse d'un mot
// n'est pas une traduction.
//
// ponytail: pas de `enum class` par enum du contrat — un `enum` Kotlin
// exploderait à la compilation dès que le serveur ajoute un jeton, ce qui est
// précisément le cas qu'on veut voir passer en français. Upgrade: un vrai type
// si le contrat devient fermé (jamais announced).

/** Repli par défaut : lisible, français, et surtout pas le jeton du serveur. */
const val ENUM_FALLBACK = "Inconnu"

/**
 * Jeton du contrat -> libellé français, jamais `null`.
 *
 * [fallback] est le libellé de l'appelant pour un jeton hors contrat : c'est lui
 * qui connaît le contexte (« Autre source », « Destinataire », « Statut
 * inconnu »), pas cette fonction. Une chaîne VIDE est traitée comme absente :
 * une étiquette vide vaut moins que le repli.
 */
fun enumFr(token: String?, fallback: String = ENUM_FALLBACK): String {
    val key = token?.trim().orEmpty()
    if (key.isEmpty()) return fallback
    return ENUM_FR[key] ?: fallback
}

private val ENUM_FR: Map<String, String> = mapOf(
    // RECIPIENT_KINDS (models.ts) — messagerie.
    "student" to "Élève",
    "teacher" to "Professeur",
    "administration" to "Administration",

    // CANTEEN_MEALS (models.ts) — cantine.
    "breakfast" to "Petit-déjeuner",
    "lunch" to "Déjeuner",
    "dinner" to "Dîner",

    // CANTEEN_MENU_STATUSES (models.ts) — cantine.
    "served" to "Servi",
    "planned" to "Prévu",

    // TIMETABLE_STATUSES (models.ts) — EDT.
    "normal" to "Normal",
    "cancelled" to "Annulé",
    "moved" to "Déplacé",

    // ABSENCE_KINDS (models.ts) — vie scolaire.
    "absence" to "Absence",
    "late" to "Retard",

    // AVERAGE_ALGORITHMS (models.ts) — notes. Libellé COURT du sélecteur ; le
    // libellé long (« Moyenne des matières ») est de la rédaction d'écran, pas
    // une traduction, donc il reste dans `Averages.kt`.
    "subject" to "Matières",
    "weighted" to "Pondérée",
    "median" to "Médiane",

    // SECURITY_ALERT_KINDS (events.ts) — alertes sécurité.
    "injection_neutralized" to "Injection neutralisée",

    // `SecurityAlert.source` n'est PAS un enum : le contrat dit « origine
    // pipeline », 1..64 caractères. Les trois valeurs que le serveur produit
    // sont donc nommées ici, et tout le reste retombe sur « Autre source ».
    "revision" to "Fiches de révision",
    "homework" to "Devoirs",
    "manuals" to "Manuels",
)
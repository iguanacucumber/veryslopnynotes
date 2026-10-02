package fr.veryslopnynotes.ui

// #74 : mention "fournie" vs "estimée" sur l'onglet Notes.
// org.json = plateforme Android (aucune dépendance ajoutée). Le payload est
// une donnée structurée du contrat 0.2.0 : on lit deux champs, jamais de
// texte libre interprété (I6). Absent/malformé = null = aucun affichage
// (pas de valeur inventée, pas de crash sur cache ancien).
// ponytail: lecture de general.{value,origin,algorithm} seulement. Upgrade:
// liste par matière quand l'écran Notes aura son vrai rendu (#74 suite).
// ponytail: arrondi HALF_UP (String.format) ; un .005 exact peut s'afficher
// 0,01 de plus que le miroir TS (toFixed). Sans effet sur la décision
// fournie/estimée, qui ne dépend que de origin.

data class GeneralAverageUi(
    val value: Double,
    val provided: Boolean,
    val algorithm: String,
)

fun generalAverageFrom(payload: String): GeneralAverageUi? {
    return try {
        val root = org.json.JSONObject(payload)
        val averages = root.optJSONObject("averages") ?: return null
        val general = averages.optJSONObject("general") ?: return null
        if (general.isNull("value")) return null
        val value = general.optDouble("value", Double.NaN)
        if (value.isNaN()) return null
        val origin = general.optString("origin", "")
        val algorithm = averages.optString("algorithm", "")
        if (origin != "provided" && origin != "estimated") return null
        GeneralAverageUi(value = value, provided = origin == "provided", algorithm = algorithm)
    } catch (_: Exception) {
        null
    }
}

/** "12,50/20 (moyenne fournie)" ou "(moyenne estimée, algorithme subject)". */
fun averageLabel(a: GeneralAverageUi?): String {
    if (a == null) return "Moyenne indisponible."
    val value = String.format(java.util.Locale.FRANCE, "%.2f", a.value)
    val origin = if (a.provided) "fournie" else "estimée"
    val algo = if (a.provided || a.algorithm.isEmpty()) "" else ", algorithme $a.algorithm"
    return "$value/20 (moyenne $origin$algo)"
}

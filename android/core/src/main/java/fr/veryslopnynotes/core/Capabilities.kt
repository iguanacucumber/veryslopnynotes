package fr.veryslopnynotes.core

/**
 * Capacités dynamiques : liste des onglets actifs chez l'établissement, lue sur
 * GET /v1/capabilities. Onglet ABSENT = capacité false → l'app masque l'entrée
 * de navigation.
 *
 * `null` = rien n'est affirmé (payload illisible, capacités non déterminées) :
 * on ne masque alors RIEN. Une liste VIDE est au contraire un contrat AFFIRMÉ
 * (l'établissement n'expose aucun onglet), donc un contrat invalide vaut
 * `null`, jamais une liste vide.
 *
 * Fichier SANS dépendance Android (la LECTURE JSON vit dans
 * `CapabilitiesJson.kt`) : le harnais de parité compile ce modèle avec `kotlinc`.
 *
 * Miroir de `shared/contracts/models.ts` (TAB_CAPABILITIES, Capabilities).
 */
data class Capabilities(
    val accountId: String,
    val tabs: List<String>,
    val fetchedAt: String,
) {
    fun isEnabled(tab: String): Boolean = tabs.contains(tab)

    companion object {
        // Miroir de TAB_CAPABILITIES, ordre canonique identique.
        val TABS = listOf(
            "grades",
            "homework",
            "timetable",
            "news",
            "menus",
            "attendance",
            "punishments",
            "discussions",
            "profile",
        )

        // Onglets réellement masquables côté UI (entrées de navigation Profil).
        const val NEWS = "news"
        const val MENUS = "menus"
        const val ATTENDANCE = "attendance"
        const val PUNISHMENTS = "punishments"

        const val MAX_TABS = 9
        const val MAX_ACCOUNT_ID = 64

        /**
         * Règle de masquage : capacité connue → on suit la liste ; inconnue
         * (null) → on garde l'entrée visible.
         */
        fun visible(caps: Capabilities?, tab: String): Boolean = caps?.isEnabled(tab) ?: true
    }
}

package fr.veryslopnynotes.core

/**
 * Capacités dynamiques (#87, parité Papillon) : liste des onglets actifs chez
 * l'établissement, lue sur GET /v1/capabilities. Onglet ABSENT de la liste =
 * capacité false → l'app masque l'entrée de navigation (et l'écran concerné
 * affiche son état vide propre, jamais une erreur).
 *
 * `null` = rien n'est affirmé : payload illisible ou capacités non déterminées
 * côté serveur. On masque alors RIEN — une panne réseau ou une version de
 * serveur plus ancienne ne doit pas faire disparaître les onglets.
 *
 * Une liste VIDE est un contrat AFFIRMÉ (l'établissement n'expose aucun
 * onglet) : elle dit le contraire de `null`, qui dit « je ne sais pas »
 * (#413). Un contrat invalide vaut donc `null`, jamais une liste vide.
 *
 * Fichier SANS dépendance Android (la LECTURE JSON du contrat vit dans
 * `CapabilitiesJson.kt` : `org.json` est une API Android, indisponible hors
 * Gradle) : le harnais de parité compile ce modèle avec `kotlinc` seul.
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
         * Règle de masquage : capacité connue → on suit la liste ; capacité
         * inconnue (null) → on garde l'entrée visible (état par défaut).
         */
        fun visible(caps: Capabilities?, tab: String): Boolean = caps?.isEnabled(tab) ?: true
    }
}

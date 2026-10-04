package fr.veryslopnynotes.core

import org.json.JSONObject

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

        /**
         * Payload `{"capabilities": {...}}` → capacités. `capabilities: null`
         * (non déterminées), liste illisible, onglet inconnu ou doublon → null
         * (« rien n'est affirmé »), jamais une liste inventée.
         */
        fun parse(body: String?): Capabilities? {
            if (body.isNullOrBlank()) return null
            return try {
                val root = JSONObject(body)
                if (root.isNull("capabilities")) return null
                val c = root.optJSONObject("capabilities") ?: return null
                val accountId = c.optString("accountId", "").trim()
                if (accountId.isEmpty() || accountId.length > MAX_ACCOUNT_ID) return null
                val arr = c.optJSONArray("tabs") ?: return null
                val tabs = mutableListOf<String>()
                for (i in 0 until arr.length()) {
                    if (tabs.size >= MAX_TABS) return null
                    val t = arr.optString(i, "").trim()
                    if (t.isEmpty() || !TABS.contains(t) || tabs.contains(t)) return null
                    tabs.add(t)
                }
                val fetchedAt = c.optString("fetchedAt", "").trim()
                if (fetchedAt.isEmpty()) return null
                Capabilities(accountId = accountId, tabs = tabs, fetchedAt = fetchedAt)
            } catch (_: Exception) {
                null
            }
        }
    }
}
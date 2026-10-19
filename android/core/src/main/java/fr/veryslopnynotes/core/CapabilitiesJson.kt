package fr.veryslopnynotes.core

import org.json.JSONObject

/**
 * LECTURE JSON du contrat de capacités (#87, #413).
 *
 * `org.json` est une API Android : ce fichier ne compile PAS hors Gradle
 * (le harnais de parité compile le modèle pur `Capabilities.kt` avec
 * `kotlinc` seul). D'où la séparation : le MODÈLE est testable partout, sa
 * lecture JSON reste côté Android.
 *
 * Règle (#413) : un contrat INVALIDE vaut « rien n'est affirmé » (`null`),
 * jamais une liste d'onglets vide — une liste vide signifie « tous les
 * onglets désactivés » et blackouterait la navigation. Mêmes conditions que
 * `CapabilityProbe.fromProbe` : compte vide/trop long, onglet inconnu ou
 * doublon, trop d'onglets, date illisible.
 */
object CapabilitiesJson {
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
            if (accountId.isEmpty() || accountId.length > Capabilities.MAX_ACCOUNT_ID) return null
            val arr = c.optJSONArray("tabs") ?: return null
            val tabs = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                if (tabs.size >= Capabilities.MAX_TABS) return null
                val t = arr.optString(i, "").trim()
                if (t.isEmpty() || !Capabilities.TABS.contains(t) || tabs.contains(t)) return null
                tabs.add(t)
            }
            val fetchedAt = c.optString("fetchedAt", "").trim()
            // Une date illisible n'affirme AUCUNE capacité (même verdict que
            // `CapabilityProbe.fromProbe` et que le contrat TS `isCapabilities`).
            if (fetchedAt.isEmpty() || isoMillis(fetchedAt) == null) return null
            Capabilities(accountId = accountId, tabs = tabs, fetchedAt = fetchedAt)
        } catch (_: Exception) {
            null
        }
    }
}

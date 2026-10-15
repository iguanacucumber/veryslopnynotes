package fr.veryslopnynotes.core

/**
 * Réduction sonde -> liste d'onglets (#87, port Kotlin #203).
 *
 * Port Kotlin (#203), testé par les miroirs Android. Un onglet absent de
 * l'établissement n'est pas une erreur, c'est une capacité `false` : on ne
 * DEVINE jamais un `true`, un onglet non observé est simplement absent de la
 * liste. Observation vide = aucun onglet actif (l'app masque tout, elle ne casse
 * rien).
 *
 * Fichier SANS dépendance Android (`Capabilities.parse`, lui, lit du JSON via
 * `org.json` et reste dans `Capabilities.kt`) : le harnais de parité compile ce
 * fichier avec `kotlinc` seul, sans SDK.
 *
 * Pur : aucun réseau, aucun SQLite (I3).
 */
object CapabilityProbe {
    /**
     * Réduit une observation (onglet -> actif ?) à la liste contractuelle : ordre
     * canonique `TABS`, sans doublon, uniquement les onglets observés actifs.
     * Contrat invalide (accountId vide, date illisible) → AUCUNE capacité
     * affirmée (liste vide), jamais une liste inventée.
     */
    fun fromProbe(accountId: String, probe: Map<String, Boolean>, at: String): Capabilities {
        val id = accountId.trim()
        val tabs = Capabilities.TABS.filter { probe[it] == true }
        val fetchedAt = at.trim()
        // `isCapabilities` exige une date lisible (`Date.parse`) : une chaîne non
        // datée n'affirme AUCUNE capacité. `isoMillis` ne couvre que l'ISO (avec ou
        // sans fuseau, avec ou sans heure) — c'est tout ce que le mapper produit,
        // donc tout ce sur quoi la parité est exigible.
        if (id.isEmpty() || id.length > Capabilities.MAX_ACCOUNT_ID ||
            fetchedAt.isEmpty() || isoMillis(fetchedAt) == null ||
            tabs.size > Capabilities.MAX_TABS
        ) {
            return Capabilities(accountId = id, tabs = emptyList(), fetchedAt = fetchedAt)
        }
        return Capabilities(accountId = id, tabs = tabs, fetchedAt = fetchedAt)
    }

    /**
     * Capacité d'un onglet. Absent = capacités NON déterminées : la réponse
     * n'affirme rien, donc faux (l'app applique sa propre règle sur
     * `capabilities == null` : rien n'est masqué).
     */
    fun enabled(caps: Capabilities?, tab: String): Boolean = caps?.tabs?.contains(tab) == true

    /**
     * Onglets désactivés = tous les onglets connus moins ceux observés actifs.
     * Capacités NON déterminées → AUCUN masquage déduit (même règle que
     * `enabled`).
     */
    fun disabled(caps: Capabilities?): List<String> {
        if (caps == null) return emptyList()
        return Capabilities.TABS.filter { !caps.tabs.contains(it) }
    }
}

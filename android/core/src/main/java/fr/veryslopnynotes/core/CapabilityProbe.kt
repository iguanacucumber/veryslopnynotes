package fr.veryslopnynotes.core

/**
 * Réduction sonde -> liste d'onglets.
 *
 * Un onglet absent de l'établissement est une capacité `false`, jamais un `true`
 * deviné. Une observation VIDE est un contrat AFFIRMÉ : l'app masque tout.
 *
 * Fichier SANS dépendance Android (la lecture JSON vit dans `CapabilitiesJson.kt`) :
 * le harnais de parité compile ce fichier avec `kotlinc`.
 *
 * Pur : aucun réseau, aucun SQLite (I3).
 */
object CapabilityProbe {
    /**
     * Réduit une observation (onglet -> actif ?) à la liste contractuelle.
     * Contrat INVALIDE → `null` : AUCUNE capacité affirmée, surtout PAS une liste
     * VIDE (elle signifierait « tous les onglets désactivés » et blackouterait
     * la navigation au lieu d'échouer en ouvert).
     */
    fun fromProbe(accountId: String, probe: Map<String, Boolean>, at: String): Capabilities? {
        val id = accountId.trim()
        val tabs = Capabilities.TABS.filter { probe[it] == true }
        val fetchedAt = at.trim()
        // `isCapabilities` exige une date lisible : une chaîne non datée n'affirme
        // AUCUNE capacité. `isoMillis` couvre tout ce que le mapper produit.
        if (id.isEmpty() || id.length > Capabilities.MAX_ACCOUNT_ID ||
            fetchedAt.isEmpty() || isoMillis(fetchedAt) == null ||
            tabs.size > Capabilities.MAX_TABS
        ) {
            return null
        }
        return Capabilities(accountId = id, tabs = tabs, fetchedAt = fetchedAt)
    }

    /**
     * Capacité d'un onglet. Absent = capacités NON déterminées : faux, et l'app
     * applique sa propre règle sur `capabilities == null` (rien n'est masqué).
     */
    fun enabled(caps: Capabilities?, tab: String): Boolean = caps?.tabs?.contains(tab) == true

    /**
     * Onglets désactivés = tous les onglets connus moins ceux observés actifs.
     * Capacités NON déterminées → AUCUN masquage déduit.
     */
    fun disabled(caps: Capabilities?): List<String> {
        if (caps == null) return emptyList()
        return Capabilities.TABS.filter { !caps.tabs.contains(it) }
    }
}

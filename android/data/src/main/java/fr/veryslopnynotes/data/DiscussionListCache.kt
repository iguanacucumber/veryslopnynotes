package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Discussion

/**
 * Objets `Discussion` de la DERNIÈRE liste, gardés 60 s : enrichir un fil
 * visible ou l'ouvrir réutilise la liste déjà téléchargée au lieu de refaire
 * `ListeMessagerie`. Mémoire seule, jamais le disque ; [clear] à la
 * déconnexion (I4).
 */
internal object DiscussionListCache {
    private const val TTL_MS = 60_000L

    private var entries: List<Discussion> = emptyList()
    private var at: Long = 0L

    @Synchronized
    fun get(now: Long = System.currentTimeMillis()): List<Discussion>? {
        if (entries.isEmpty()) return null
        // Horloge reculée : une marque « future » est EXPIRÉE, sinon la liste
        // resterait fraîche pour toujours.
        if (CachePolicy.isExpired(TTL_MS, at, now)) {
            clear()
            return null
        }
        return entries
    }

    @Synchronized
    fun put(list: List<Discussion>, now: Long = System.currentTimeMillis()) {
        entries = list
        at = now
    }

    @Synchronized
    fun clear() {
        entries = emptyList()
        at = 0L
    }
}

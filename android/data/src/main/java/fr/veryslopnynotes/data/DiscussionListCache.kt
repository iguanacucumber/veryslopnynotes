package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Discussion

/**
 * Objets `Discussion` de la DERNIÈRE liste, gardés 60 s : enrichir un fil
 * visible ou l'ouvrir réutilise la liste déjà téléchargée au lieu de refaire
 * `ListeMessagerie`. Mémoire seule, jamais le disque ; [clear] à la
 * déconnexion (I16).
 *
 * Chaque entrée est liée à l'ÉPOQUE de session qui l'a lue : une lecture
 * commencée avant une purge ne peut ni la republier (`put`) ni la servir
 * (`get`) après la bascule.
 */
internal object DiscussionListCache {
    private const val TTL_MS = 60_000L

    private var entries: List<Discussion> = emptyList()
    private var at: Long = 0L
    private var epoch: Long = Long.MIN_VALUE

    @Synchronized
    fun get(observed: Long, now: Long = System.currentTimeMillis()): List<Discussion>? {
        if (entries.isEmpty()) return null
        // Époque différente ou session déjà changée : l'entrée appartient à un
        // autre compte, elle n'est jamais servie.
        if (epoch != observed || !SessionEpoch.isCurrent(observed)) {
            clear()
            return null
        }
        // Horloge reculée : une marque « future » est EXPIRÉE, sinon la liste
        // resterait fraîche pour toujours.
        if (CachePolicy.isExpired(TTL_MS, at, now)) {
            clear()
            return null
        }
        return entries
    }

    @Synchronized
    fun put(list: List<Discussion>, observed: Long, now: Long = System.currentTimeMillis()): Boolean {
        // La session a changé pendant la lecture : ne pas écrire l'ancienne
        // liste dans le cache du compte suivant.
        if (!SessionEpoch.isCurrent(observed)) return false
        entries = list
        at = now
        epoch = observed
        return true
    }

    @Synchronized
    fun clear() {
        entries = emptyList()
        at = 0L
        epoch = Long.MIN_VALUE
    }
}

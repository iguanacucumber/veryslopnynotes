package fr.veryslopnynotes.core

/**
 * Pagination locale des messages d'un fil. Le protocole Pronote ne pagine pas
 * `ListeMessages` : la première ouverture télécharge le fil entier, puis les
 * pages plus anciennes sortent du cache mémoire — une requête par fil ouvert,
 * zéro par « charger plus ancien ».
 */
object MessagePaging {
    /** Taille de page : miroir de la fenêtre web #966. */
    const val PAGE_SIZE = 50

    /** Fils enrichis dans la liste : la fenêtre visible, jamais tout l'historique. */
    const val MAX_VISIBLE_ENRICH = 12

    /** Identifiants visibles pas encore enrichis, bornés par [max]. */
    fun enrichBatch(
        visible: Iterable<String>,
        already: Set<String>,
        max: Int = MAX_VISIBLE_ENRICH,
    ): List<String> {
        val bound = max.coerceAtLeast(0)
        val out = LinkedHashSet<String>()
        if (bound == 0) return emptyList()
        for (raw in visible) {
            val id = raw.trim()
            if (id.isEmpty() || id.length > DiscussionRules.MAX_ID) continue
            if (id in already) continue
            out.add(id)
            if (out.size >= bound) break
        }
        return out.toList()
    }
}

/**
 * Cache mémoire borné (fils, TTL) des fils déjà téléchargés. Les messages
 * restent des données du compte : [clear] est appelé à la déconnexion.
 * `@Synchronized` : le pont peut demander deux pages en parallèle.
 */
class ThreadMessagePager<T>(
    private val pageSize: Int = MessagePaging.PAGE_SIZE,
    private val maxEntries: Int = 3,
    private val ttlMs: Long = 60_000L,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    data class Page<T>(val items: List<T>, val start: Int, val total: Int) {
        val hasMore: Boolean get() = start > 0
    }

    private data class Entry<T>(val items: List<T>, val at: Long)

    private val entries = LinkedHashMap<String, Entry<T>>()

    /** Dernière page avant [before] (exclusif) ; `null` = fin du fil. */
    @Synchronized
    fun page(key: String, before: Int?, fetch: () -> List<T>): Page<T> {
        val entry = live(key) ?: Entry(fetch(), clock()).also { put(key, it) }
        val total = entry.items.size
        val end = if (before == null) total else before.coerceIn(0, total)
        val start = (end - pageSize.coerceAtLeast(1)).coerceAtLeast(0)
        return Page(entry.items.subList(start, end).toList(), start, total)
    }

    @Synchronized
    fun invalidate(key: String) {
        entries.remove(key)
    }

    @Synchronized
    fun clear() {
        entries.clear()
    }

    private fun live(key: String): Entry<T>? {
        val entry = entries[key] ?: return null
        if (clock() - entry.at > ttlMs) {
            entries.remove(key)
            return null
        }
        return entry
    }

    private fun put(key: String, entry: Entry<T>) {
        entries.remove(key)
        entries[key] = entry
        while (entries.size > maxEntries) {
            val oldest = entries.keys.firstOrNull() ?: break
            entries.remove(oldest)
        }
    }
}

/** Instance partagée par le dépôt : la purge de session l'efface. */
object ThreadMessageCache {
    private val pager = ThreadMessagePager<DiscussionMessage>()

    fun page(
        key: String,
        before: Int?,
        fetch: () -> List<DiscussionMessage>,
    ): ThreadMessagePager.Page<DiscussionMessage> = pager.page(key, before, fetch)

    fun invalidate(key: String): Unit = pager.invalidate(key)

    fun clear(): Unit = pager.clear()
}

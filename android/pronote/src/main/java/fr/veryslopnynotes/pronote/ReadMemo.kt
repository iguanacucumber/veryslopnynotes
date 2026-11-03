package fr.veryslopnynotes.pronote

/**
 * Anti-redondance de TRANSPORT : garde 60 s la dernière réponse d'une lecture
 * identique (fonction + onglet + charge utile), en mémoire du process. Ce n'est
 * pas un cache de données.
 *
 * Une lecture n'est servie que si : la fonction est dans la LISTE BLANCHE, la
 * réponse a été un SUCCÈS (jamais d'erreur mémoïsée), l'entrée a moins de 60 s,
 * et la mémo n'a pas été vidée depuis (écriture, ping, `refresh`).
 *
 * Mémoire bornée par ENTRÉES et par OCTETS UTF-8 sérialisés (jamais
 * `String.length`) : une réponse qui dépasse le budget d'une entrée est
 * REFUSÉE, et les plus anciennes partent jusqu'à tenir sous le budget total.
 *
 * ponytail: cap dur 4 Mio, pas de persistance.
 * Upgrade: une mémo partagée par le process si plusieurs clients coexistent.
 */
class ReadMemo(
    private val ttlMs: Long = TTL_MS,
    private val maxEntries: Int = MAX_ENTRIES,
    private val maxBytes: Int = MAX_BYTES,
    private val maxEntryBytes: Int = MAX_ENTRY_BYTES,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val TTL_MS = 60_000L

        const val MAX_ENTRIES = 64

        /** Budget TOTAL de la mémo, clés comprises. */
        const val MAX_BYTES = 4 * 1024 * 1024

        /** Budget d'UNE entrée (clé + valeur) : au-delà, elle n'est pas gardée. */
        const val MAX_ENTRY_BYTES = 1024 * 1024

        /**
         * TOUT ce qui n'est pas dans cette liste VIDE la mémo : une écriture, un
         * ping, une authentification. Défaut prudent : une fonction inconnue est
         * traitée comme une écriture.
         */
        val READ_FUNCTIONS: Set<String> = setOf(
            "DernieresNotes",
            "PagePresence",
            "PageCahierDeTexte",
            "PageEmploiDuTemps",
            "PageActualites",
            "PageMenus",
            "ListeMessagerie",
            "ListeMessages",
            // `SaisiePublicMessage` LIT les participants (le nom trompe).
            "SaisiePublicMessage",
        )
    }

    private data class Entry(val value: JVal, val at: Long, val bytes: Int)

    private val lock = Any()
    private val entries = LinkedHashMap<String, Entry>()
    private var totalBytes = 0

    val size: Int get() = synchronized(lock) { entries.size }

    /** Octets UTF-8 sérialisés actuellement retenus. */
    val bytes: Int get() = synchronized(lock) { totalBytes }

    /**
     * `null` = fonction NON mémoïsable : l'appelant vide alors la mémo (une
     * écriture change l'état du compte, les lectures servies seraient fausses).
     */
    fun keyFor(functionName: String, onglet: Double?, payload: JVal): String? {
        if (functionName !in READ_FUNCTIONS) return null
        return functionName + "|" + (onglet?.toString() ?: "-") + "|" + Json.stringify(payload)
    }

    fun get(key: String): JVal? = synchronized(lock) {
        val entry = entries[key] ?: return null
        if (clock() - entry.at > ttlMs) {
            entries.remove(key)
            totalBytes -= entry.bytes
            return null
        }
        entry.value
    }

    /**
     * Mémorise une réponse (succès uniquement — l'appelant filtre les erreurs).
     * Une entrée trop grosse pour son budget est REFUSÉE sans toucher la mémo.
     */
    fun put(key: String, value: JVal): Unit {
        val cost = Json.utf8ByteLength(key) + Json.utf8Size(value)
        if (cost > maxEntryBytes || cost > maxBytes) return
        val now = clock()
        synchronized(lock) {
            // Les entrées périmées ne consomment plus le budget : sans ça une
            // mémo vivante évincerait des lectures FRAÎCHES au profit de mortes.
            val stale = entries.entries.iterator()
            while (stale.hasNext()) {
                val entry = stale.next().value
                if (now - entry.at > ttlMs) {
                    totalBytes -= entry.bytes
                    stale.remove()
                }
            }
            entries.remove(key)?.let { totalBytes -= it.bytes }
            entries[key] = Entry(value, now, cost)
            totalBytes += cost
            // L'entrée la plus ANCIENNE part (ordre des écritures).
            while (entries.size > maxEntries || totalBytes > maxBytes) {
                val oldest = entries.keys.firstOrNull() ?: break
                val removed = entries.remove(oldest) ?: continue
                totalBytes -= removed.bytes
            }
        }
    }

    fun clear(): Unit = synchronized(lock) {
        entries.clear()
        totalBytes = 0
    }
}

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
 * ponytail: mémoire bornée (64 entrées), pas de persistance.
 * Upgrade: une mémo partagée par le process si plusieurs clients coexistent.
 */
class ReadMemo(
    private val ttlMs: Long = TTL_MS,
    private val maxEntries: Int = MAX_ENTRIES,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val TTL_MS = 60_000L

        const val MAX_ENTRIES = 64

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

    private data class Entry(val value: JVal, val at: Long)

    private val lock = Any()
    private val entries = LinkedHashMap<String, Entry>()

    val size: Int get() = synchronized(lock) { entries.size }

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
            return null
        }
        entry.value
    }

    fun put(key: String, value: JVal): Unit = synchronized(lock) {
        entries.remove(key)
        entries[key] = Entry(value, clock())
        // L'entrée la plus ANCIENNE part (ordre des écritures).
        while (entries.size > maxEntries) {
            val oldest = entries.keys.firstOrNull() ?: break
            entries.remove(oldest)
        }
    }

    fun clear(): Unit = synchronized(lock) { entries.clear() }
}

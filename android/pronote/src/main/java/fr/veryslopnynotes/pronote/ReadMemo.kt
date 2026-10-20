package fr.veryslopnynotes.pronote

/**
 * Mémo des LECTURES identiques (#473).
 *
 * Le client reposait la MÊME question à l'établissement plusieurs fois dans la
 * même seconde :
 * - `DernieresNotes` : notes + moyennes + moyenne générale = 3 POST par
 *   période (9 pour l'écran Notes avec une période choisie) ;
 * - `PagePresence` : absences + retards + sanctions = 3 POST par période ;
 * - `PageCahierDeTexte` : la réponse porte les contenus de TOUS les cours de
 *   la semaine, donc N contenus = N POST identiques ;
 * - `PageEmploiDuTemps` : l'accueil charge les devoirs (5 semaines) ET l'EDT
 *   (3 semaines) — les semaines communes sont demandées deux fois.
 *
 * La mémo garde la DERNIÈRE réponse d'une lecture identique (fonction +
 * onglet + charge utile sérialisée) pendant 60 s, en mémoire du process. Ce
 * n'est pas un cache de données : c'est un anti-redondance de TRANSPORT — la
 * donnée reste celle de l'établissement, jamais une date inventée.
 *
 * RÈGLES (une lecture n'est servie depuis la mémo que si TOUT est vrai) :
 * - la fonction est dans la LISTE BLANCHE des lectures (une écriture, un ping
 *   ou une authentification n'y sont pas) ;
 * - la réponse a été un SUCCÈS (une erreur n'est JAMAIS mémoïsée) ;
 * - l'entrée a moins de 60 s (TTL) ;
 * - la mémo n'a pas été vidée depuis (écriture, ping, `refresh`).
 *
 * ponytail: mémoire bornée (64 entrées), pas de persistance, pas de calcul.
 * Upgrade: une mémo partagée par le process si plusieurs clients coexistent.
 */
class ReadMemo(
    private val ttlMs: Long = TTL_MS,
    private val maxEntries: Int = MAX_ENTRIES,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        /** TTL d'une entrée : 60 s (au-delà, on redemande à l'établissement). */
        const val TTL_MS = 60_000L

        /** Mémoire bornée : au plus 64 entrées vivantes. */
        const val MAX_ENTRIES = 64

        /**
         * Fonctions de LECTURE mémoïsables (liste blanche).
         *
         * TOUT ce qui n'est pas dans cette liste VIDE la mémo : une écriture
         * (`SaisieTAFFaitEleve`, `SaisieMessage`), un ping (`Navigation`), une
         * authentification (`Identification`, `Authentification`,
         * `ParametresUtilisateur`…). Le défaut est donc prudent : une fonction
         * inconnue est traitée comme une écriture.
         */
        val READ_FUNCTIONS: Set<String> = setOf(
            "DernieresNotes",      // notes, moyennes, moyenne générale
            "PagePresence",        // absences, retards, sanctions
            "PageCahierDeTexte",   // devoirs et contenus de cours
            "PageEmploiDuTemps",   // EDT
            "PageActualites",      // actus (liste et corps d'une actu)
            "PageMenus",           // cantine
            "ListeMessagerie",     // liste des fils de discussion
            "ListeMessages",       // messages d'un fil
            // `SaisiePublicMessage` LIRE les participants et les destinataires
            // d'un fil (le nom trompe : c'est une lecture, pas une écriture).
            "SaisiePublicMessage",
        )
    }

    /** Une réponse servie depuis la mémo, et l'instant de son écriture. */
    private data class Entry(val value: JVal, val at: Long)

    private val lock = Any()
    private val entries = LinkedHashMap<String, Entry>()

    /** Nombre d'entrées vivantes (mesure, tests). */
    val size: Int get() = synchronized(lock) { entries.size }

    /**
     * Clé de la mémo : `fonction | onglet | charge utile sérialisée`.
     *
     * `null` = fonction NON mémoïsable : l'appelant vide alors la mémo (une
     * écriture change l'état du compte, les lectures servies seraient fausses).
     */
    fun keyFor(functionName: String, onglet: Double?, payload: JVal): String? {
        if (functionName !in READ_FUNCTIONS) return null
        return functionName + "|" + (onglet?.toString() ?: "-") + "|" + Json.stringify(payload)
    }

    /** Réponse mémoïsée, ou `null` (absente ou périmée). */
    fun get(key: String): JVal? = synchronized(lock) {
        val entry = entries[key] ?: return null
        if (clock() - entry.at > ttlMs) {
            entries.remove(key)
            return null
        }
        entry.value
    }

    /** Mémorise une réponse (succès uniquement — l'appelant filtre les erreurs). */
    fun put(key: String, value: JVal): Unit = synchronized(lock) {
        entries.remove(key)
        entries[key] = Entry(value, clock())
        // Mémoire bornée : l'entrée la plus ANCIENNE part (l'ordre est celui
        // des écritures, la dernière écrite est la plus récente).
        while (entries.size > maxEntries) {
            val oldest = entries.keys.firstOrNull() ?: break
            entries.remove(oldest)
        }
    }

    /** Vide la mémo (écriture, ping, session renouvelée). */
    fun clear(): Unit = synchronized(lock) { entries.clear() }
}

package fr.veryslopnynotes.data

// Politique cache offline, miroir de shared/contracts/cache.ts.
// TTL = indice d'affichage (frais vs périmé) ; source de vérité = sync serveur.
// Aucun hôte tiers ici : ressources servies par serveur allowlist seul (I1).
object CachePolicy {
    const val GRADES = "grades"
    const val ASSIGNMENTS = "assignments"
    const val TIMETABLE = "timetable"
    const val NEWS = "news"
    const val MENUS = "menus"
    const val ATTENDANCE = "attendance"
    const val PUNISHMENTS = "punishments"
    const val TTL_SECURITY_ALERTS_MS = 15L * 60L * 1000L
    const val CAPABILITIES = "capabilities"

    // Messagerie : liste des fils seulement ; les messages d'un fil sont lus à
    // la demande et jamais écrits sur disque.
    const val DISCUSSIONS = "discussions"

    // Sans cette clé, l'écran n'a pas de cache : hors ligne, une liste vide est
    // indistinguable d'une absence de menace. TTL court : donnée la plus
    // sensible à l'âge. Contenu hostile borné (`sanitizeExcerpt`), purgé au logout.
    const val SECURITY_ALERTS = "security-alerts"

    // ponytail: constantes dures = miroir CACHE_TTL_MS (contrats v0). Upgrade: codegen contrats.
    const val TTL_GRADES_MS = 15L * 60L * 1000L
    const val TTL_ASSIGNMENTS_MS = 15L * 60L * 1000L
    const val TTL_TIMETABLE_MS = 60L * 60L * 1000L
    const val TTL_NEWS_MS = 60L * 60L * 1000L
    const val TTL_MENUS_MS = 6L * 60L * 60L * 1000L
    const val TTL_ATTENDANCE_MS = 60L * 60L * 1000L
    const val TTL_PUNISHMENTS_MS = 60L * 60L * 1000L
    const val TTL_CAPABILITIES_MS = 24L * 60L * 60L * 1000L

    const val TTL_DISCUSSIONS_MS = 15L * 60L * 1000L

    fun isCacheable(resource: String): Boolean =
        resource == GRADES || resource == ASSIGNMENTS || resource == TIMETABLE ||
            resource == NEWS || resource == MENUS ||
            resource == ATTENDANCE || resource == PUNISHMENTS ||
            resource == CAPABILITIES || resource == DISCUSSIONS ||
            resource == SECURITY_ALERTS

    fun ttlFor(resource: String): Long = when (resource) {
        GRADES -> TTL_GRADES_MS
        ASSIGNMENTS -> TTL_ASSIGNMENTS_MS
        TIMETABLE -> TTL_TIMETABLE_MS
        NEWS -> TTL_NEWS_MS
        MENUS -> TTL_MENUS_MS
        ATTENDANCE -> TTL_ATTENDANCE_MS
        PUNISHMENTS -> TTL_PUNISHMENTS_MS
        CAPABILITIES -> TTL_CAPABILITIES_MS
        DISCUSSIONS -> TTL_DISCUSSIONS_MS
        SECURITY_ALERTS -> TTL_SECURITY_ALERTS_MS
        else -> throw IllegalArgumentException("ressource non cachable: $resource")
    }

    // Une entrée datée dans le FUTUR (dérive d'horloge) est PÉRIMÉE : la
    // soustraction seule la dirait fraîche, le badge disparaîtrait et
    // `shouldFetch` ne relirait plus jamais le client. Règle PARTAGÉE avec
    // `cacheStatus` (shared/contracts/cache.ts), borne du TTL comprise.
    fun isStale(resource: String, fetchedAt: Long, now: Long): Boolean {
        if (fetchedAt > now) return true
        return now - fetchedAt > ttlFor(resource)
    }

    /**
     * Une écriture CONFIRMÉE invalide toutes les entrées de la ressource : le
     * cache ne ressert plus l'état d'avant. Le TTL ne change pas ; seule
     * l'invalidation suit l'écriture, jamais l'écran qui l'a demandée.
     */
    fun invalidateAfterWrite(store: CacheStore, resource: String) {
        if (isCacheable(resource)) store.clear(resource)
    }

    // Une entrée fraîche suffit à l'écran, sauf geste EXPLICITE (`force`) ;
    // entrée absente ou périmée = relecture. Une entrée d'une autre requête est
    // ABSENTE, jamais un cache-hit (sinon « semaine suivante » sert la
    // précédente et « trimestre 2 » les moyennes du 1).
    fun shouldFetch(entry: CachedEntry?, resource: String, query: String, now: Long, force: Boolean): Boolean =
        force || entry == null ||
            normalizeQuery(entry.query) != normalizeQuery(query) ||
            isStale(resource, entry.fetchedAt, now)

    /**
     * Requête normalisée : l'IDENTITÉ de la réponse. Fins de ligne → espaces
     * (une entrée = une ligne de requête) et bords coupés. La longueur est
     * bornée par la passerelle : tronquer ici fusionnerait deux requêtes.
     */
    fun normalizeQuery(query: String): String =
        query.trim().replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')

    /**
     * Clé de DÉDOUBLONNAGE d'une lecture en vol : la requête normalisée et le
     * fait d'écrire le cache. Une lecture sans écriture et une lecture avec
     * écriture de la même requête ne partagent pas le travail — sinon la
     * première décide pour les deux et le cache n'est jamais enregistré.
     */
    fun dedupKey(resource: String, query: String, save: Boolean): String =
        "$resource|${normalizeQuery(query)}|save=$save"
}

/**
 * Exécute une écriture locale puis invalide le cache de la ressource. Une
 * écriture qui ÉCHOUE ne purge rien : rien n'a été écrit. L'invalidation suit
 * l'écriture, pas l'écran qui l'a demandée.
 */
internal fun writeAndInvalidate(store: CacheStore, resource: String, block: () -> Unit) {
    block()
    CachePolicy.invalidateAfterWrite(store, resource)
}

package fr.veryslopnynotes.data

// Politique cache offline phase 4 (#14), miroir de shared/contracts/cache.ts.
// TTL = indice affichage (frais vs badge périmé) ; source vérité = sync serveur.
// Aucun hôte tiers ici : ressources servies par serveur allowlist seul (I1).
object CachePolicy {
    const val GRADES = "grades"
    const val ASSIGNMENTS = "assignments"
    const val TIMETABLE = "timetable"
    // #79 : actualités établissement (liste lente, TTL = EDT).
    const val NEWS = "news"
    // #81 : menus cantine (publiés à la semaine).
    const val MENUS = "menus"
    // #77 : vie scolaire — absences/retards + sanctions (rythme EDT).
    const val ATTENDANCE = "attendance"
    const val PUNISHMENTS = "punishments"
    // #144 : alertes sécurité, cadence notes (voir SECURITY_ALERTS).
    const val TTL_SECURITY_ALERTS_MS = 15L * 60L * 1000L
    // #87 : onglets Pronote actifs (miroir CACHEABLE_RESOURCES contrats). Cache
    // = l'app masque un onglet hors-ligne ; invalidé par CacheInvalidated.
    const val CAPABILITIES = "capabilities"

    // #80 : messagerie — liste des fils seulement (donnée personnelle, purgée au
    // logout par AccountStore.logout → clearAll ; les messages d'un fil sont lus
    // à la demande et jamais écrits sur disque).
    const val DISCUSSIONS = "discussions"

    // #144 : alertes de sécurité. SANS cette clé, l'écran n'avait aucun cache :
    // hors ligne la liste était vide et il affichait « Aucune alerte. Bon signe. »
    // — impossible à distinguer d'une absence de menace. TTL court (cadence des
    // notes) parce qu'une alerte est la donnée la plus sensible à l'âge ici. Le
    // contenu hostile reste une DONNÉE bornée (`SecurityAlert.sanitizeExcerpt`),
    // purgé comme le reste au logout.
    const val SECURITY_ALERTS = "security-alerts"

    // ponytail: constantes dures = miroir CACHE_TTL_MS (contrats v0). Upgrade: codegen contrats.
    const val TTL_GRADES_MS = 15L * 60L * 1000L
    const val TTL_ASSIGNMENTS_MS = 15L * 60L * 1000L
    const val TTL_TIMETABLE_MS = 60L * 60L * 1000L
    const val TTL_NEWS_MS = 60L * 60L * 1000L
    const val TTL_MENUS_MS = 6L * 60L * 60L * 1000L
    // #77 : vie scolaire, rythme EDT (saisie par l'établissement).
    const val TTL_ATTENDANCE_MS = 60L * 60L * 1000L
    const val TTL_PUNISHMENTS_MS = 60L * 60L * 1000L
    // #87 : configuration d'établissement, très lente.
    const val TTL_CAPABILITIES_MS = 24L * 60L * 60L * 1000L

    // #80 : liste des fils, cadence devoirs (messages fréquents).
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

    // Frais si fetchedAt + TTL couvre now, périmé sinon (badge app).
    //
    // #372 : une entrée datée dans le FUTUR (dérive d'horloge d'appareil, NTP
    // qui recule) est PÉRIMÉE. La soustraction seule la disait fraîche
    // (`now - fetchedAt` négatif) — donc le badge « périmé » disparaissait et
    // `shouldFetch` ne relisait plus jamais le client local : les données
    // servies agingaient sans fin (capabilities : TTL 24 h → jusqu'à 48 h de
    // données périmées vendues comme fraîches). Règle PARTAGÉE avec le contrat
    // TS (`cacheStatus`, shared/contracts/cache.ts) : les deux implémentations
    // rendent le même verdict, borne du TTL incluse des deux côtés.
    fun isStale(resource: String, fetchedAt: Long, now: Long): Boolean {
        if (fetchedAt > now) return true
        return now - fetchedAt > ttlFor(resource)
    }

    /**
     * #369 : une écriture CONFIRMÉE invalide les entrées de cache de la
     * ressource — le cache ne doit plus resservir l'état d'avant (devoir «
     * fait » qui se décoche au retour, fil supprimé qui réapparaît, compteur
     * figé). Le TTL ne change pas : ce sont les entrées qui partent, pas la
     * politique. #477 : TOUTES les entrées de la ressource (une par requête).
     *
     * La source de vérité est le natif : l'invalidation suit l'écriture, pas
     * l'écran qui l'a demandée (une seule fois, jamais des deux côtés).
     */
    fun invalidateAfterWrite(store: CacheStore, resource: String) {
        if (isCacheable(resource)) store.clear(resource)
    }

    // #311 : faut-il relire le client local ? Règle PURE (comme isStale), donc
    // testable sans téléphone : une entrée fraîche suffit à l'écran, sauf geste
    // EXPLICITE de l'utilisateur (`force` : tirail, « Actualiser », changement de
    // semaine/période/algorithme). Entrée absente ou périmée = on relit, comme
    // avant — sans ça le badge « périmé » afficherait une donnée qu'on pourrait
    // rafraîchir. La première entrée sur un écran n'est PAS un geste.
    //
    // #365 : la réponse dépend de la REQUÊTE (semaine, période, algorithme).
    // L'entrée de cache porte la requête qui l'a produite : une entrée d'une
    // autre requête est une entrée ABSENTE (⇒ relecture), jamais un cache-hit.
    // Sans ça, « semaine suivante » servait le payload de la semaine précédente
    // (écran vide) et « trimestre 2 » les moyennes du trimestre précédent.
    fun shouldFetch(entry: CachedEntry?, resource: String, query: String, now: Long, force: Boolean): Boolean =
        force || entry == null ||
            normalizeQuery(entry.query) != normalizeQuery(query) ||
            isStale(resource, entry.fetchedAt, now)

    /**
     * Requête normalisée : c'est l'IDENTITÉ de la réponse (#365). Les fins de
     * ligne deviennent des espaces (une entrée de cache = une ligne de requête,
     * cf. `FileCacheStore`) et les bords sont coupés. La longueur est bornée par
     * la passerelle (200 caractères), pas ici : tronquer une requête fusionnerait
     * deux requêtes différentes.
     */
    fun normalizeQuery(query: String): String =
        query.trim().replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')

    /**
     * Clé de DÉDOUBLONNAGE d'une lecture en vol (#509).
     *
     * La requête normalisée (l'identité de la réponse) et le fait d'ÉCRIRE le
     * cache font partie de la clé : une lecture SANS écriture (l'assistant,
     * qui cherche un devoir dans le cache) et une lecture AVEC écriture
     * (l'écran, qui alimente le cache) de la même requête ne doivent pas
     * partager le même travail — sinon celle qui arrive en premier décide
     * pour les deux, et l'entrée du cache n'est jamais enregistrée.
     */
    fun dedupKey(resource: String, query: String, save: Boolean): String =
        "$resource|${normalizeQuery(query)}|save=$save"
}

/**
 * #369 : exécute une écriture locale puis invalide le cache de la ressource.
 *
 * L'écriture CONFIRMÉE fait partir l'entrée de cache (le cache ne ressert
 * plus l'état d'avant : devoir « fait » qui se décoche, fil supprimé qui
 * réapparaît). Une écriture qui ÉCHOUE ne purge rien : rien n'a été écrit.
 *
 * La source de vérité est le natif : l'invalidation suit l'écriture, pas
 * l'écran qui l'a demandée (une seule fois, jamais des deux côtés).
 */
internal fun writeAndInvalidate(store: CacheStore, resource: String, block: () -> Unit) {
    block()
    CachePolicy.invalidateAfterWrite(store, resource)
}

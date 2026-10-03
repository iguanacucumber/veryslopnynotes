package fr.veryslopnynotes.data

// Politique cache offline phase 4 (#14), miroir de shared/contracts/cache.ts.
// TTL = indice affichage (frais vs badge périmé) ; source vérité = sync serveur.
// Aucun hôte tiers ici : ressources servies par serveur allowlist seul (I1).
object CachePolicy {
    const val GRADES = "grades"
    const val ASSIGNMENTS = "assignments"
    const val TIMETABLE = "timetable"
    // #78 : évaluations par compétences (miroir CACHEABLE_RESOURCES contrats).
    const val EVALUATIONS = "evaluations"

    // #79 : actualités établissement (liste lente, TTL = EDT).
    const val NEWS = "news"
    // #81 : menus cantine (publiés à la semaine).
    const val MENUS = "menus"
    // #77 : vie scolaire — absences/retards + sanctions (rythme EDT).
    const val ATTENDANCE = "attendance"
    const val PUNISHMENTS = "punishments"
    // #87 : onglets Pronote actifs (miroir CACHEABLE_RESOURCES contrats). Cache
    // = l'app masque un onglet hors-ligne ; invalidé par CacheInvalidated.
    const val CAPABILITIES = "capabilities"

    // #80 : messagerie — liste des fils seulement (donnée personnelle, purgée au
    // logout par AccountStore.logout → clearAll ; les messages d'un fil sont lus
    // à la demande et jamais écrits sur disque).
    const val DISCUSSIONS = "discussions"

    // ponytail: constantes dures = miroir CACHE_TTL_MS (contrats v0). Upgrade: codegen contrats.
    const val TTL_GRADES_MS = 15L * 60L * 1000L
    const val TTL_ASSIGNMENTS_MS = 15L * 60L * 1000L
    const val TTL_TIMETABLE_MS = 60L * 60L * 1000L
    const val TTL_NEWS_MS = 60L * 60L * 1000L
    const val TTL_MENUS_MS = 6L * 60L * 60L * 1000L
    // #78 : évaluations par compétences, même cadence que les notes.
    const val TTL_EVALUATIONS_MS = 15L * 60L * 1000L
    // #77 : vie scolaire, rythme EDT (saisie par l'établissement).
    const val TTL_ATTENDANCE_MS = 60L * 60L * 1000L
    const val TTL_PUNISHMENTS_MS = 60L * 60L * 1000L
    // #87 : configuration d'établissement, très lente.
    const val TTL_CAPABILITIES_MS = 24L * 60L * 60L * 1000L

    // #80 : liste des fils, cadence devoirs (messages fréquents).
    const val TTL_DISCUSSIONS_MS = 15L * 60L * 1000L

    fun isCacheable(resource: String): Boolean =
        resource == GRADES || resource == ASSIGNMENTS || resource == TIMETABLE ||
            resource == EVALUATIONS || resource == NEWS || resource == MENUS ||
            resource == ATTENDANCE || resource == PUNISHMENTS ||
            resource == CAPABILITIES || resource == DISCUSSIONS

    fun ttlFor(resource: String): Long = when (resource) {
        GRADES -> TTL_GRADES_MS
        ASSIGNMENTS -> TTL_ASSIGNMENTS_MS
        TIMETABLE -> TTL_TIMETABLE_MS
        NEWS -> TTL_NEWS_MS
        MENUS -> TTL_MENUS_MS
        EVALUATIONS -> TTL_EVALUATIONS_MS
        ATTENDANCE -> TTL_ATTENDANCE_MS
        PUNISHMENTS -> TTL_PUNISHMENTS_MS
        CAPABILITIES -> TTL_CAPABILITIES_MS
        DISCUSSIONS -> TTL_DISCUSSIONS_MS
        else -> throw IllegalArgumentException("ressource non cachable: $resource")
    }

    // Frais si fetchedAt + TTL couvre now, périmé sinon (badge app).
    fun isStale(resource: String, fetchedAt: Long, now: Long): Boolean =
        now - fetchedAt > ttlFor(resource)
}

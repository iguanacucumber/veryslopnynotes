package fr.veryslopnynotes.data

// Politique cache offline phase 4 (#14), miroir de shared/contracts/cache.ts.
// TTL = indice affichage (frais vs badge périmé) ; source vérité = sync serveur.
// Aucun hôte tiers ici : ressources servies par serveur allowlist seul (I1).
object CachePolicy {
    const val GRADES = "grades"
    const val ASSIGNMENTS = "assignments"
    const val TIMETABLE = "timetable"
    const val MENUS = "menus"

    // ponytail: constantes dures = miroir CACHE_TTL_MS (contrats v0). Upgrade: codegen contrats.
    const val TTL_GRADES_MS = 15L * 60L * 1000L
    const val TTL_ASSIGNMENTS_MS = 15L * 60L * 1000L
    const val TTL_TIMETABLE_MS = 60L * 60L * 1000L
    const val TTL_MENUS_MS = 6L * 60L * 60L * 1000L

    fun isCacheable(resource: String): Boolean =
        resource == GRADES || resource == ASSIGNMENTS || resource == TIMETABLE || resource == MENUS

    fun ttlFor(resource: String): Long = when (resource) {
        GRADES -> TTL_GRADES_MS
        ASSIGNMENTS -> TTL_ASSIGNMENTS_MS
        TIMETABLE -> TTL_TIMETABLE_MS
        MENUS -> TTL_MENUS_MS
        else -> throw IllegalArgumentException("ressource non cachable: $resource")
    }

    // Frais si fetchedAt + TTL couvre now, périmé sinon (badge app).
    fun isStale(resource: String, fetchedAt: Long, now: Long): Boolean =
        now - fetchedAt > ttlFor(resource)
}

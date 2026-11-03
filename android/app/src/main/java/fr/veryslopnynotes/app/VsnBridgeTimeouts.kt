package fr.veryslopnynotes.app

/**
 * Budgets du pont, UNE source pour Kotlin et miroir exact de
 * `web/src/bridge/types.ts` (vérifié par le contrat exécuté).
 *
 * Le JS attend TOUJOURS plus longtemps que le natif : à budget égal, la
 * réponse native arrive au même instant que l'abandon et se perd (#371).
 */
object BridgeTimeouts {
    /** Budget total d'une requête scolaire (miroir de `DEFAULT_REQUEST_DEADLINE_MS`). */
    const val REQUEST_DEADLINE_MS = 15_000L

    /** Attente par défaut d'un dépôt (`await`). */
    const val AWAIT_DEFAULT_MS = 20_000L

    /** Récupération d'un extrait de manuel via le scraper, avant le LLM. */
    const val AWAIT_MANUAL_MS = 35_000L

    /** Budget TOTAL de lecture des pièces jointes d'un devoir (#631). */
    const val ATTACHMENT_BUDGET_MS = 20_000L

    /** Attente native d'un appel LLM, STRICTEMENT plus longue que le fournisseur. */
    const val AWAIT_LLM_MS = 40_000L

    /**
     * Budget fournisseur de `llm.askHomework` : réparti sur deux tentatives,
     * il se termine avant [AWAIT_LLM_MS] et la reprise a le temps d'arriver.
     */
    const val HOMEWORK_LLM_TIMEOUT_MS = 35_000L

    /** Attente d'une photo : l'élève cadre, l'appareil écrit, puis la transcription. */
    const val AWAIT_PHOTO_MS = 180_000L

    /** Plafond du chemin le plus long d'un devoir : le JS le dépasse (#371). */
    const val MAX_NATIVE_WAIT_MS =
        AWAIT_DEFAULT_MS + AWAIT_MANUAL_MS + ATTACHMENT_BUDGET_MS + AWAIT_LLM_MS

    /** Nombre de requêtes HTTP qu'une lecture peut enchaîner (une par tranche). */
    const val MAX_RESOURCE_REQUESTS = 6

    /** Plafond d'une lecture multi-requêtes, toujours sous le timeout JS. */
    const val MAX_RESOURCE_DEADLINE_MS = MAX_RESOURCE_REQUESTS * REQUEST_DEADLINE_MS

    /** Toutes les clés de ressource, pour que le contrat compare la table entière. */
    val RESOURCE_KEYS = listOf(
        "grades",
        "assignments",
        "timetable",
        "discussions",
        "news",
        "canteen",
        "attendance",
        "punishments",
        "alerts",
        "capabilities",
        "profile",
        "periods",
    )

    /**
     * Échéance d'une lecture, par ressource : une lecture qui enchaîne une
     * requête par tranche (notes, absences, sanctions) ne tient pas dans le
     * délai d'un seul appel. Le natif rend alors un résultat partiel (cache
     * périmé + erreur) au lieu d'abandonner le travail en cours.
     */
    fun resourceDeadlineMs(key: String): Long = when (key) {
        // Balayage local, aucun réseau.
        "alerts" -> 10_000L
        // Deux requêtes : tranches puis informations.
        "capabilities" -> 30_000L
        // Une requête par semaine de cours rattachée.
        "timetable", "assignments" -> 60_000L
        // Une requête par tranche, plus l'enrichissement borné des fils.
        "grades", "attendance", "punishments", "discussions" -> MAX_RESOURCE_DEADLINE_MS
        // Profil, actualités, menus, tranches : une seule requête.
        else -> AWAIT_DEFAULT_MS
    }
}

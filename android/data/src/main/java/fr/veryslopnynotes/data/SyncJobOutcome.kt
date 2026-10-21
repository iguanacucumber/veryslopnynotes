package fr.veryslopnynotes.data

/**
 * Décision du job de fond (#406).
 *
 * La session vit en RAM (`PronoteSession`) : un job WorkManager démarre un
 * process NEUF, sans interface, donc SANS session. Le job lisait
 * `PronoteSession.client` (nul) et renvoyait `Result.success()` : le sync de
 * fond était un NO-OP dès que l'app était fermée depuis plus d'un cycle de
 * job, et sans aucun réessai.
 *
 * Règle : pas de session = pas de lecture = RÉESSAI (`Result.retry()`), jamais
 * un succès qui n'a rien fait.
 *
 * Pur (aucun import Android, aucun type du port) : le test unitaire compile ce
 * fichier et l'EXÉCUTE (`tests/unit/kotlin-sync-worker.test.ts`).
 * ponytail: deux issues, pas une machine à états. Le type PORTE la session :
 * le worker la reçoit sans `!!` (pas de client nullable qui traîne).
 * Upgrade: distinguer « jamais appairé » (rien à synchroniser) de « session
 * non restaurable » (réseau KO) si le bruit des retries gêne.
 */
sealed interface SyncJobOutcome<out T> {
    /** Session disponible : le job lit les ressources et réécrit le cache. */
    data class Refresh<T>(val session: T) : SyncJobOutcome<T>

    /** Aucune session : le job réessaiera (backoff WorkManager). */
    data object Retry : SyncJobOutcome<Nothing>
}

/**
 * Décision du job : la session si elle est lisible, sinon un réessai.
 *
 * @param session session locale lisible (`null` = absente, ou restauration
 *   impossible : jamais appairé, jeton mort, réseau KO).
 */
fun <T> syncJobOutcome(session: T?): SyncJobOutcome<T> =
    if (session == null) SyncJobOutcome.Retry else SyncJobOutcome.Refresh(session)

/**
 * Ce que le job de fond LIT dans la file partagée (#403).
 *
 * `Failed` porte la CAUSE : c'est elle qui décide réessai ou session morte
 * (`isSessionFailure`). La lecture ne LÈVE JAMAIS hors de la file : l'échec
 * est une VALEUR, pas une exception.
 */
sealed interface SyncJobRead {
    /** Le payload lu. */
    data class Ok(val payload: String) : SyncJobRead

    /** La lecture a échoué : la cause décide (réessai ou appairage). */
    data class Failed(val cause: Exception) : SyncJobRead
}

/**
 * Une lecture NE LÈVE JAMAIS (#403) : l'échec est un résultat, pas une
 * exception — la cause est conservée, c'est elle qui décide.
 *
 * Depuis #530, la file NE perd plus ses callbacks : elle livre l'échec à
 * tous ceux de la clé. `safeRead` garde l'avantage du job : la cause d'une
 * `Exception` du client est classée ICI (session morte ou réessai) ; un
 * `Error` — qui n'est pas un échec métier — remonte à la file, qui le livre
 * en échec (le job réessaie).
 */
fun safeRead(read: () -> String): SyncJobRead =
    try {
        SyncJobRead.Ok(read())
    } catch (e: Exception) {
        SyncJobRead.Failed(e)
    }

/**
 * Ce que le job de fond FAIT du résultat d'une lecture (#403).
 *
 * La sémantique est celle d'avant (#406) : une session MORTE = l'app doit se
 * ré-appairer (le job « réussit » : un réessai ne ressusciterait pas la
 * session), tout autre échec = RÉESSAI (backoff WorkManager).
 */
sealed interface SyncJobDecision {
    /** Lecture OK : le payload est réécrit dans le cache. */
    data class Loaded(val payload: String) : SyncJobDecision

    /** La session est MORTE : l'app doit se ré-appairer. */
    data object SessionDead : SyncJobDecision

    /** Échec banal : le job réessaiera (backoff WorkManager). */
    data object Retry : SyncJobDecision
}

/** La décision du job sur une lecture : session morte = appairage, sinon réessai. */
fun syncJobDecision(read: SyncJobRead): SyncJobDecision = when (read) {
    is SyncJobRead.Ok -> SyncJobDecision.Loaded(read.payload)
    is SyncJobRead.Failed ->
        if (isSessionFailure(read.cause)) SyncJobDecision.SessionDead else SyncJobDecision.Retry
}

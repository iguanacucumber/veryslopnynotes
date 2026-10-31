package fr.veryslopnynotes.data

/**
 * Décision du job de fond.
 *
 * La session vit en RAM : un job WorkManager démarre un process NEUF, sans
 * interface, donc SANS session. Pas de session = pas de lecture = RÉESSAI,
 * jamais un succès qui n'a rien fait.
 *
 * Pur (aucun import Android, aucun type du port) : le test unitaire compile ce
 * fichier et l'EXÉCUTE. ponytail: deux issues, pas une machine à états ; le
 * type PORTE la session (pas de client nullable qui traîne).
 * Upgrade: distinguer « jamais appairé » de « session non restaurable » si le
 * bruit des retries gêne.
 */
sealed interface SyncJobOutcome<out T> {
    data class Refresh<T>(val session: T) : SyncJobOutcome<T>

    data object Retry : SyncJobOutcome<Nothing>
}

/**
 * Décision du job : la session si elle est lisible, sinon un réessai. `null` =
 * absente, ou restauration impossible (jamais appairé, jeton mort, réseau KO).
 */
fun <T> syncJobOutcome(session: T?): SyncJobOutcome<T> =
    if (session == null) SyncJobOutcome.Retry else SyncJobOutcome.Refresh(session)

/**
 * Ce que le job LIT dans la file partagée. `Failed` porte la CAUSE : c'est
 * elle qui décide réessai ou session morte. La lecture ne lève jamais hors de
 * la file : l'échec est une valeur.
 */
sealed interface SyncJobRead {
    data class Ok(val payload: String) : SyncJobRead

    data class Failed(val cause: Exception) : SyncJobRead
}

/**
 * Une lecture ne lève jamais : la cause est conservée, c'est elle qui décide.
 * `safeRead` classe une `Exception` du client (session morte ou réessai) ; un
 * `Error` remonte à la file, qui le livre en échec.
 */
fun safeRead(read: () -> String): SyncJobRead =
    try {
        SyncJobRead.Ok(read())
    } catch (e: Exception) {
        SyncJobRead.Failed(e)
    }

/**
 * Ce que le job FAIT du résultat d'une lecture : une session MORTE = l'app
 * doit se ré-appairer (le job « réussit », un réessai ne ressusciterait pas la
 * session), tout autre échec = RÉESSAI (backoff WorkManager).
 */
sealed interface SyncJobDecision {
    data class Loaded(val payload: String) : SyncJobDecision

    data object SessionDead : SyncJobDecision

    data object Retry : SyncJobDecision
}

fun syncJobDecision(read: SyncJobRead): SyncJobDecision = when (read) {
    is SyncJobRead.Ok -> SyncJobDecision.Loaded(read.payload)
    is SyncJobRead.Failed ->
        if (isSessionFailure(read.cause)) SyncJobDecision.SessionDead else SyncJobDecision.Retry
}

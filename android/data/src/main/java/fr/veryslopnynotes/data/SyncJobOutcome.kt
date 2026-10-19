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

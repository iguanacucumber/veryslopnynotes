package fr.veryslopnynotes.data

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * LA file d'attente du client local — PARTAGÉE par tous.
 *
 * Un seul fil daemon pour tout le process : l'interface ET le job de fond
 * lisent le MÊME client, qui est MUTABLE (`refresh()` réassigne son état).
 * Deux lectures simultanées = deux authentifications = erreur 25, puis
 * l'ÉTABLISSEMENT limite le compte.
 *
 * UNE SEULE instance : le tableau des requêtes en vol de `LocalRequestQueue`
 * est par instance, donc deux instances ne se dédoublonnent pas entre elles.
 *
 * CLÉS : un préfixe par producteur (`ressource|query`, `job|ressource|`) :
 * un résultat n'est jamais livré à un producteur d'un autre type.
 *
 * Logique pure : stdlib `java.util.concurrent`, rejouée par le harnais de
 * parité JVM. Un travail qui JETTE est un échec LIVRÉ à tous les callbacks.
 */
object ClientQueue {
    /**
     * La file unique, typée `Any` : chaque producteur a son propre type, la
     * clé fait le lien entre le travail et ses callbacks.
     *
     * `@PublishedApi` : `submit` est `inline`, elle doit voir la file.
     */
    @PublishedApi
    internal val queue = LocalRequestQueue<Any>()

    /**
     * Soumet [work] ; [deliver] reçoit son résultat OU son échec. Un travail
     * qui jette ne laisse aucune promesse en attente.
     *
     * `inline` + `reified` : le cast interne est VÉRIFIÉ à l'exécution. Un
     * cast effacé ne jette jamais : une collision de clés livrerait un résultat
     * du mauvais type, puis un `ClassCastException` avalé plus loin.
     */
    inline fun <reified T : Any> submit(
        key: String,
        crossinline work: () -> T,
        crossinline deliver: (QueueOutcome<T>) -> Unit,
    ) {
        queue.submit(key, work = { work() }, deliver = { o -> deliver(cast(o)) })
    }

    /**
     * Le cast est sûr PAR CONSTRUCTION : la clé lie un travail à ses callbacks,
     * et les clés sont namespacées par producteur.
     *
     * S'il JETTE quand même (collision de clés), l'échec est un RÉSULTAT : le
     * callback fautif le reçoit au lieu d'attendre le délai natif.
     */
    @PublishedApi
    internal inline fun <reified T : Any> cast(o: QueueOutcome<Any>): QueueOutcome<T> = when (o) {
        is QueueOutcome.Failed -> o
        is QueueOutcome.Ok -> try {
            QueueOutcome.Ok(o.value as T)
        } catch (t: Throwable) {
            QueueOutcome.Failed(t)
        }
    }

    /**
     * Soumet [work] et ATTEND son résultat (au plus [timeoutMs]).
     *
     * Pour le job de fond, bloquant : aucun blocage croisé, la file n'appelle
     * jamais l'appelant en retour (le `deliver` ouvre le loquet).
     *
     * `null` = délai dépassé : l'appelant réessaiera plus tard. Le travail
     * reste en file (pas d'annulation) : il lira le client, sans conséquence.
     * Un travail qui JETTE est livré en échec, donc l'attente finit tout de suite.
     */
    inline fun <reified T : Any> submitAndAwait(
        key: String,
        timeoutMs: Long,
        crossinline work: () -> T,
    ): QueueOutcome<T>? {
        val latch = CountDownLatch(1)
        var outcome: QueueOutcome<T>? = null
        submit(key, work = work, deliver = { o -> outcome = o; latch.countDown() })
        if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return null
        return outcome
    }
}

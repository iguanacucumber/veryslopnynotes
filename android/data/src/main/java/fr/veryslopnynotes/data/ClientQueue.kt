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
     * UN seau à jetons pour tout le process : la file sérialise, le seau
     * cadence. Sans lui, un écran qui recharge cinq ressources part en rafale
     * et déclenche la limitation de l'établissement.
     */
    @PublishedApi
    internal val pacer = SchoolPacer()

    /**
     * La file unique, typée `Any` : chaque producteur a son propre type, la
     * clé fait le lien entre le travail et ses callbacks.
     *
     * `@PublishedApi` : `submit` est `inline`, elle doit voir la file.
     */
    @PublishedApi
    internal val queue = LocalRequestQueue<Any>().also { it.attachPacer(pacer) }

    /** Cooldown persistant (fichier) : un redémarrage ne repart pas à zéro. */
    fun attachCooldown(store: CooldownStore?) {
        pacer.attachStore(store)
    }

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
        // Le jeton de l'APPELANT suit le travail : la file exécute sur un autre
        // fil, un timeout JS ou `bridge.cancel` doit quand même couper le socket.
        val cancellation = RequestScope.current()
        queue.submit(key, work = { RequestScope.with(cancellation) { work() } }, deliver = { o -> deliver(cast(o)) })
    }

    /**
     * Travail dont le résultat est livré par ses propres callbacks (dépôts à
     * callback). Un échec de file — un `Error` compris — est TOUJOURS livré à
     * [onFailure] : l'écran ne reste jamais en attente.
     */
    inline fun submitUnit(
        key: String,
        crossinline work: () -> Unit,
        crossinline onFailure: (Throwable) -> Unit,
    ) {
        submit<Unit>(
            key,
            work = { work() },
            deliver = { outcome -> if (outcome is QueueOutcome.Failed) onFailure(outcome.cause) },
        )
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
        // Délai du job = abandon de l'appelant : le travail ne doit pas rester
        // à lire un socket après le retour.
        val timeoutCancellation = if (RequestScope.current() == null) RequestCancellation() else null
        submit(
            key,
            work = { RequestScope.with(timeoutCancellation) { work() } },
            deliver = { o -> outcome = o; latch.countDown() },
        )
        if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            timeoutCancellation?.cancel()
            return null
        }
        return outcome
    }
}

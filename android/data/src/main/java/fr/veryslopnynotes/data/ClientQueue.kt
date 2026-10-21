package fr.veryslopnynotes.data

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * LA file d'attente du client local (#403) — PARTAGÉE par tous.
 *
 * Un seul fil daemon pour tout le process : l'interface ET le job de fond
 * lisent le MÊME client, qui est MUTABLE (`refresh()` réassigne
 * `communication`, `attributes` et la clé AES). Deux lectures simultanées =
 * deux authentifications sur le même compte = « Exceeded max authorization
 * requests » (erreur 25) → l'ÉTABLISSEMENT limite le compte.
 *
 * UNE SEULE instance : `LocalRequestQueue` garde son FIL unique dans son
 * compagnon, mais son tableau de requêtes EN VOL est par instance — deux
 * instances ne se dédoublonnent pas entre elles, et « la file du job » ne
 * serait pas « la file de l'écran ». Avant, chaque dépôt avait la sienne et
 * le job de fond lisait le client EN DIRECT (sans file du tout).
 *
 * CLÉS : un préfixe par producteur (`ressource|query` pour les écrans,
 * `job|ressource|` pour le job de fond). Deux producteurs ne partagent donc
 * JAMAIS une clé : un résultat n'est jamais livré à un producteur d'un autre
 * type.
 *
 * Logique pure : stdlib `java.util.concurrent`, aucun import Android — compilée
 * et EXÉCUTÉE pour de vrai par le harnais de parité JVM
 * (`tests/unit/kotlin-local-queue.test.ts`).
 *
 * Un travail qui JETTE est un ÉCHEC LIVRÉ (#530) : tous les callbacks de la
 * clé le reçoivent. Aucun appelant n'attend le délai natif (ni la promesse
 * JS, ni le job de fond).
 */
object ClientQueue {
    /**
     * LA file unique. Le résultat est typé `Any` : chaque producteur a son
     * propre type (`RefreshOutcome` pour les écrans, `SyncJobRead` pour le
     * job de fond) — la clé fait le lien entre le travail et ses callbacks.
     *
     * `@PublishedApi` : `submit` est `inline` (le cast interne est vérifié),
     * elle doit donc voir la file.
     */
    @PublishedApi
    internal val queue = LocalRequestQueue<Any>()

    /**
     * Soumet [work] à la file partagée ; [deliver] reçoit son résultat OU son
     * échec.
     *
     * L'échec est un RÉSULTAT (#530) : un travail qui jette ne laisse AUCUNE
     * promesse en attente (la promesse JS attendait le délai natif, le job de
     * fond brûlait ses 120 s).
     *
     * `inline` + `reified` : le cast interne est VÉRIFIÉ à l'exécution. Un
     * cast effacé (`as T` sans `reified`) ne jette JAMAIS — une collision de
     * clés aurait livré un résultat du mauvais type, puis un
     * `ClassCastException` plus loin, avalé en silence.
     */
    inline fun <reified T : Any> submit(
        key: String,
        crossinline work: () -> T,
        crossinline deliver: (QueueOutcome<T>) -> Unit,
    ) {
        queue.submit(key, work = { work() }, deliver = { o -> deliver(cast(o)) })
    }

    /**
     * Le cast interne est sûr PAR CONSTRUCTION : la clé lie un travail à ses
     * callbacks (la file ne livre un résultat qu'aux callbacks de la même
     * clé), et les clés sont namespacées par producteur.
     *
     * S'il JETTE quand même (collision de clés : deux types pour une même
     * clé), l'échec est un RÉSULTAT, pas un silence (#530) : le callback
     * fautif reçoit l'échec au lieu d'attendre le délai natif.
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
     * Soumet [work] à la file partagée et ATTEND son résultat (au plus
     * [timeoutMs]).
     *
     * Pour le job de fond, BLOQUANT (`Worker.doWork`) : il pose sa lecture
     * dans la file et attend. Aucun blocage croisé : la file n'appelle JAMAIS
     * l'appelant en retour (le `deliver` pose le résultat et ouvre le
     * loquet), donc l'attente finit dès que la file est servie.
     *
     * `null` = délai dépassé (la file est occupée par une longue lecture) :
     * l'appelant réessaiera plus tard. Le travail reste alors en file (la
     * file n'a pas d'annulation) : il lira le client, sans conséquence.
     * Un travail qui JETTE est livré en échec (`QueueOutcome.Failed`) : là,
     * l'attente finit tout de suite (#530).
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

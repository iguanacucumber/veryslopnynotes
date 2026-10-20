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
 */
object ClientQueue {
    /**
     * LA file unique. Le résultat est typé `Any` : chaque producteur a son
     * propre type (`RefreshOutcome` pour les écrans, `SyncJobRead` pour le
     * job de fond) — la clé fait le lien entre le travail et ses callbacks.
     */
    private val queue = LocalRequestQueue<Any>()

    /**
     * Soumet [work] à la file partagée ; [deliver] reçoit son résultat.
     *
     * Le cast interne est sûr PAR CONSTRUCTION : la clé lie un travail à ses
     * callbacks (la file ne livre un résultat qu'aux callbacks de la même
     * clé), et les clés sont namespacées par producteur.
     */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> submit(key: String, work: () -> T, deliver: (T) -> Unit) {
        queue.submit(key, work = { work() }, deliver = { deliver(it as T) })
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
     */
    fun <T : Any> submitAndAwait(key: String, timeoutMs: Long, work: () -> T): T? {
        val latch = CountDownLatch(1)
        var result: T? = null
        submit(key, work = work, deliver = { r -> result = r; latch.countDown() })
        if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return null
        return result
    }
}

package fr.veryslopnynotes.data

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Ce que la file livre : la valeur du travail, ou son ÉCHEC.
 *
 * L'échec est une VALEUR : un travail qui jette livre son échec à TOUS les
 * callbacks de la clé (sinon promesse pendante, job qui brûle son délai, et
 * co-demandeurs jamais servis).
 */
sealed interface QueueOutcome<out T> {
    data class Ok<T>(val value: T) : QueueOutcome<T>

    /**
     * Le travail a jeté — `Exception` comme `Error` : la cause est livrée,
     * c'est elle qui décide (réessai, appairage, échec d'écran).
     */
    data class Failed(val cause: Throwable) : QueueOutcome<Nothing>
}

/**
 * File d'attente unique du client local.
 *
 * UN fil daemon pour tout le process : les appels au `Client` partagé
 * s'exécutent dans l'ordre d'arrivée, jamais en parallèle. Le client est
 * mutable (`refresh()` réassigne son état) : deux lectures simultanées =
 * course, login en double, erreur 25 côté établissement.
 *
 * Dédoublonnage : une requête identique déjà en vol ne re-poste pas ; ses
 * callbacks reçoivent le MÊME résultat. La clé est libérée dès la fin, donc
 * un appel identique plus tard repart normalement.
 *
 * Logique pure (stdlib `java.util.concurrent`), rejouée par le harnais de
 * parité JVM ; le relais main thread reste dans le dépôt, via `deliver`.
 */
class LocalRequestQueue<T> {
    // ponytail: un verrou et une LinkedHashMap : les soumissions sont des taps
    //   UI (contention nulle), pas un chemin chaud. Upgrade: ConcurrentHashMap
    //   si plusieurs producteurs haute fréquence arrivent un jour.
    private val lock = Any()
    private val inFlight = LinkedHashMap<String, MutableList<(QueueOutcome<T>) -> Unit>>()

    /**
     * Exécute [work] sur le fil unique. Si [key] est déjà en vol, [deliver] est
     * empilé : tous les callbacks reçoivent le MÊME résultat, dans l'ordre.
     */
    fun submit(key: String, work: () -> T, deliver: (QueueOutcome<T>) -> Unit) {
        synchronized(lock) {
            val waiting = inFlight[key]
            if (waiting != null) {
                waiting.add(deliver)
                return
            }
            inFlight[key] = mutableListOf(deliver)
            // Soumission DANS le verrou : l'ordre du verrou = l'ordre de la file.
            executor.execute { run(key, work) }
        }
    }

    private fun run(key: String, work: () -> T) {
        // `Throwable` et non `Exception` : un `Error` (OOM) ne doit pas laisser
        // les callbacks en attente non plus.
        val outcome: QueueOutcome<T> = try {
            QueueOutcome.Ok(work())
        } catch (t: Throwable) {
            QueueOutcome.Failed(t)
        }
        // Clé libérée DANS LES DEUX CAS : sinon la volée suivante attendrait
        // un vol fantôme pour toujours.
        val callbacks = synchronized(lock) { inFlight.remove(key).orEmpty() }
        for (cb in callbacks) {
            // Un callback fautif n'affame pas les autres. Signalé sans le
            // message de l'exception, qui peut nommer un compte ou une URL.
            try {
                cb(outcome)
            } catch (t: Throwable) {
                System.err.println("file locale : callback en échec (${t.javaClass.simpleName})")
            }
        }
    }

    companion object {
        /**
         * UN fil daemon pour tout le process (« d'abord arrivé, d'abord servi »).
         * Daemon : la file ne retient pas la JVM à la fermeture.
         */
        private val executor: ExecutorService =
            Executors.newSingleThreadExecutor { r ->
                Thread(r, "local-request-queue").apply { isDaemon = true }
            }
    }
}

package fr.veryslopnynotes.data

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Ce que la file livre à ses callbacks : la valeur du travail, ou son ÉCHEC.
 *
 * L'échec est une VALEUR (#530) : un travail qui jette livre son échec à TOUS
 * les callbacks de la clé. Avant, l'exception était RELANCÉE : les callbacks
 * n'étaient jamais appelés — la promesse JS attendait le délai natif (20 s) et
 * le job de fond brûlait ses 120 s ; les co-demandeurs de la même clé n'étaient
 * jamais servis.
 */
sealed interface QueueOutcome<out T> {
    /** Le travail a réussi : voici sa valeur. */
    data class Ok<T>(val value: T) : QueueOutcome<T>

    /**
     * Le travail a jeté — une `Exception` comme un `Error` : la cause est
     * livrée, c'est elle qui décide (réessai, appairage, échec d'écran).
     */
    data class Failed(val cause: Throwable) : QueueOutcome<Nothing>
}

/**
 * File d'attente unique du client local (#310).
 *
 * UN fil daemon pour tout le process : les appels au `Client` partagé
 * s'exécutent dans l'ordre d'arrivée, jamais en parallèle. Le client est
 * mutable (`refresh()` réassigne `communication`, `attributes`, `funcOptions`) :
 * deux lectures simultanées = course, login en double, risque d'erreur 25
 * (« Exceeded max authorization requests ») côté établissement.
 *
 * Dédoublonnage : une requête identique DÉJÀ EN VOL (même clé `ressource|query`)
 * ne re-poste pas ; ses callbacks sont servis avec le MÊME résultat que la
 * première. La clé est libérée dès que l'exécution se termine : un appel
 * identique plus tard repart normalement.
 *
 * Logique pure : stdlib `java.util.concurrent`, aucun import Android, aucune
 * dépendance data — compilée et exécutée pour de vrai par le harnais de parité
 * JVM (`tests/unit/kotlin-local-queue.test.ts`). Le relais main thread
 * (`Handler`) reste dans le dépôt, via `deliver`.
 *
 * `work` PEUT jeter (#530) : l'échec est alors un RÉSULTAT
 * (`QueueOutcome.Failed`), livré à TOUS les callbacks de la clé — aucune
 * promesse ne reste en attente. Avant, l'exception évadée laissait les
 * callbacks non servis (comme l'ancien `Thread` par lecture qui mourait) ;
 * elle libérait la clé, sinon les requêtes suivantes attendraient un vol
 * fantôme.
 */
class LocalRequestQueue<T> {
    // ponytail: un verrou et une LinkedHashMap : les soumissions sont des taps
    //   UI (contention nulle), pas un chemin chaud. Upgrade: ConcurrentHashMap
    //   si plusieurs producteurs haute fréquence arrivent un jour.
    private val lock = Any()
    private val inFlight = LinkedHashMap<String, MutableList<(QueueOutcome<T>) -> Unit>>()

    /**
     * Exécute [work] sur le fil unique. Si [key] est déjà en vol, [deliver] est
     * simplement empilé : tous les callbacks de la volée reçoivent le MÊME
     * résultat que la première requête, dans l'ordre d'arrivée.
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
        // L'échec est un RÉSULTAT (#530) : il est livré à TOUS les callbacks
        // de la clé, donc aucune promesse ne reste en attente. `Throwable` et
        // non `Exception` : un `Error` (OOM) est un échec comme un autre — il
        // ne doit pas laisser les callbacks en attente non plus.
        val outcome: QueueOutcome<T> = try {
            QueueOutcome.Ok(work())
        } catch (t: Throwable) {
            QueueOutcome.Failed(t)
        }
        // Clé libérée DANS LES DEUX CAS : sinon la volée suivante attendrait
        // un vol fantôme pour toujours.
        val callbacks = synchronized(lock) { inFlight.remove(key).orEmpty() }
        for (cb in callbacks) {
            // Un callback fautif n'affame pas les autres : avant #310, chaque
            // lecture avait son propre Thread (isolée de la même façon). Il est
            // SIGNALÉ (jamais avalé en silence) — sans le message de
            // l'exception, qui peut nommer un compte ou une URL.
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
         * Daemon : la file ne retient jamais la JVM à la fermeture de l'app.
         */
        private val executor: ExecutorService =
            Executors.newSingleThreadExecutor { r ->
                Thread(r, "local-request-queue").apply { isDaemon = true }
            }
    }
}

package fr.veryslopnynotes.data

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

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
 * `work` ne doit pas jeter (les dépôts rendent toujours un résultat) : une
 * exception évadée laisse les callbacks non servis, comme l'ancien `Thread`
 * par lecture qui mourait — mais elle libère la clé, sinon les requêtes
 * suivantes attendraient un vol fantôme.
 */
class LocalRequestQueue<T> {
    // ponytail: un verrou et une LinkedHashMap : les soumissions sont des taps
    //   UI (contention nulle), pas un chemin chaud. Upgrade: ConcurrentHashMap
    //   si plusieurs producteurs haute fréquence arrivent un jour.
    private val lock = Any()
    private val inFlight = LinkedHashMap<String, MutableList<(T) -> Unit>>()

    /**
     * Exécute [work] sur le fil unique. Si [key] est déjà en vol, [deliver] est
     * simplement empilé : tous les callbacks de la volée reçoivent le MÊME
     * résultat que la première requête, dans l'ordre d'arrivée.
     */
    fun submit(key: String, work: () -> T, deliver: (T) -> Unit) {
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
        val result = try {
            work()
        } catch (t: Throwable) {
            // Clé libérée même en cas de crash : sans ça, la volée suivante
            // attendrait un vol fantôme pour toujours.
            synchronized(lock) { inFlight.remove(key) }
            throw t
        }
        val callbacks = synchronized(lock) { inFlight.remove(key).orEmpty() }
        for (cb in callbacks) {
            // Un callback fautif n'affame pas les autres : avant #310, chaque
            // lecture avait son propre Thread (isolée de la même façon).
            try {
                cb(result)
            } catch (_: Exception) {
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

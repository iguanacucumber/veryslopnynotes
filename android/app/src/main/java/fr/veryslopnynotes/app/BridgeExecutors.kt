package fr.veryslopnynotes.app

import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.FutureTask
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Le pont ne doit jamais faire la queue : un pool fixe immobilisait tous les
 * appels pendant un `await` long (20 s, 45 s pour le LLM), donc `app.backState`
 * et les lectures de l'accueil gelaient. Logique pure (`java.util.concurrent`).
 *
 * Les Futures soumis sont SUIVIS : une déconnexion coupe un appel dont le
 * résultat ne sera plus livré (aucun fil orphelin jusqu'au plafond).
 */
class BridgeExecutors {
    companion object {
        const val LLM_WORKERS = 2

        /**
         * Liste fermée : une méthode LLM oubliée ici gèlerait le pont.
         */
        val LLM_METHODS = setOf("llm.askHomework", "llm.generateRevision", "llm.teacherTurn")

        // `llm.solvePhoto` et `lessons.addPhoto` restent dans `calls` : leur
        // attente comprend le CADRAGE de la photo (plusieurs minutes), qui
        // immobiliserait un worker LLM.
    }

    private val calls: ExecutorService = Executors.newCachedThreadPool(daemon("vsn-bridge"))
    private val llm: ExecutorService = Executors.newFixedThreadPool(LLM_WORKERS, daemon("vsn-bridge-llm"))
    private val futures: MutableSet<Future<*>> = ConcurrentHashMap.newKeySet()

    fun workerFor(method: String): ExecutorService = if (method in LLM_METHODS) llm else calls

    /**
     * Soumet un appel et RETIENT son Future jusqu'à sa fin : l'annulation
     * individuelle (logout) ou globale (`close`) ne laisse aucun fil tourner.
     */
    fun submit(method: String, task: () -> Unit): Future<*> {
        val holder = AtomicReference<Future<*>>()
        val future = object : FutureTask<Unit>(Callable {
            task()
            Unit
        }) {
            override fun done() {
                holder.get()?.let { futures.remove(it) }
            }
        }
        holder.set(future)
        futures.add(future)
        workerFor(method).execute(future)
        return future
    }

    /** Futures encore en vol (les terminés s'en retirent seuls). */
    val inFlight: Int get() = futures.size

    /** Coupe TOUS les appels en vol (fermeture ou changement de compte). */
    fun cancelAll() {
        for (future in futures.toList()) future.cancel(true)
    }

    val isShutdown: Boolean
        get() = calls.isShutdown && llm.isShutdown

    /** Aucun fil ne survit à la WebView. */
    fun shutdown() {
        cancelAll()
        calls.shutdownNow()
        llm.shutdownNow()
    }

    /** Daemon : la file ne retient jamais le process à la fermeture. */
    private fun daemon(prefix: String): ThreadFactory {
        val count = AtomicInteger()
        return ThreadFactory { runnable ->
            Thread(runnable, "$prefix-${count.incrementAndGet()}").apply { isDaemon = true }
        }
    }
}

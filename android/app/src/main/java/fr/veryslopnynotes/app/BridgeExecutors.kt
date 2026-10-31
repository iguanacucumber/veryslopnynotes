package fr.veryslopnynotes.app

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * Le pont ne doit jamais faire la queue : un pool fixe immobilisait tous les
 * appels pendant un `await` long (20 s, 45 s pour le LLM), donc `app.back` et
 * les lectures de l'accueil gelaient. Logique pure (`java.util.concurrent`).
 */
class BridgeExecutors {
    companion object {
        const val LLM_WORKERS = 2

        /**
         * Liste fermée : une méthode LLM oubliée ici gèlerait le pont.
         */
        val LLM_METHODS = setOf("llm.askHomework", "llm.generateRevision")

        // `llm.solvePhoto` et `lessons.addPhoto` restent dans `calls` : leur
        // attente comprend le CADRAGE de la photo (plusieurs minutes), qui
        // immobiliserait un worker LLM.
    }

    private val calls: ExecutorService = Executors.newCachedThreadPool(daemon("vsn-bridge"))
    private val llm: ExecutorService = Executors.newFixedThreadPool(LLM_WORKERS, daemon("vsn-bridge-llm"))

    fun workerFor(method: String): ExecutorService = if (method in LLM_METHODS) llm else calls

    val isShutdown: Boolean
        get() = calls.isShutdown && llm.isShutdown

    /** Aucun fil ne survit à la WebView. */
    fun shutdown() {
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

package fr.veryslopnynotes.app

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * Exécuteurs du pont natif (#393).
 *
 * LE PONT NE DOIT JAMAIS FAIRE LA QUEUE. Un pool fixe de deux fils était
 * IMMOBILISÉ pendant toute l'attente d'un appel (le `await` du pont bloque
 * jusqu'à 20 s — 45 s pour le LLM) : les cinq lectures de l'accueil mises en
 * file tuaient `app.back` (le bouton retour) pendant 20 s, et deux appels LLM
 * gelaient le pont 45 s.
 *
 * Deux files, deux rôles :
 *  - [calls] : un fil par appel, jamais borné. Un appel long n'immobilise que
 *    son PROPRE fil : le retour répond même avec cinq lectures et deux appels
 *    LLM en vol. Le nombre d'appels simultanés est borné par l'interface (le
 *    JS sérialise les lectures), pas par le pont.
 *  - [llm] : les opérations LLM, à part et borné ([LLM_WORKERS] fils) : deux
 *    appels LLM simultanés ne gèlent plus le pont, et une rafale ne crée pas
 *    une gerbe de fils.
 *
 * Logique pure : `java.util.concurrent` seul, aucun import Android — le
 * harnais de parité JVM la compile et l'EXÉCUTE
 * (`tests/unit/kotlin-bridge-executors.test.ts`).
 */
class BridgeExecutors {
    /** Fils de la file LLM : deux appels LLM simultanés suffisent. */
    companion object {
        const val LLM_WORKERS = 2

        /**
         * Méthodes LLM : les opérations longues ont leur propre file.
         *
         * Le reste du pont passe par [calls]. Liste fermée : une méthode LLM
         * oubliée ici gèlerait le pont comme avant.
         */
        val LLM_METHODS = setOf("llm.askHomework", "llm.generateRevision")

        // `llm.solvePhoto` et `lessons.addPhoto` restent volontairement dans
        // `calls` : leur attente comprend le CADRAGE de la photo par l'élève
        // (plusieurs minutes), pas seulement l'appel LLM. Les mettre dans la
        // file à deux fils immobiliserait un worker LLM pendant ce temps.
    }

    private val calls: ExecutorService = Executors.newCachedThreadPool(daemon("vsn-bridge"))
    private val llm: ExecutorService = Executors.newFixedThreadPool(LLM_WORKERS, daemon("vsn-bridge-llm"))

    /** La file qui porte la méthode : le LLM à part, le reste sur les appels. */
    fun workerFor(method: String): ExecutorService = if (method in LLM_METHODS) llm else calls

    /** Les deux files sont-elles fermées ? (fin de vie de la WebView) */
    val isShutdown: Boolean
        get() = calls.isShutdown && llm.isShutdown

    /** Fin de vie : aucun fil ne survit à la WebView. */
    fun shutdown() {
        calls.shutdownNow()
        llm.shutdownNow()
    }

    /** Fils daemon : la file ne retient jamais le process à la fermeture. */
    private fun daemon(prefix: String): ThreadFactory {
        val count = AtomicInteger()
        return ThreadFactory { runnable ->
            Thread(runnable, "$prefix-${count.incrementAndGet()}").apply { isDaemon = true }
        }
    }
}

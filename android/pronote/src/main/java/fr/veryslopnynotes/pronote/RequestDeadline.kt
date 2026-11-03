package fr.veryslopnynotes.pronote

import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException

/** Échéance MONOTONE d'une requête : redirects, en-têtes et corps partagent le même budget. */
internal class RequestDeadline(totalMs: Long) {
    private val atNanos = System.nanoTime() + totalMs.coerceAtLeast(1L) * 1_000_000L

    fun remainingMs(): Long = (atNanos - System.nanoTime()) / 1_000_000L

    fun check() {
        if (remainingMs() <= 0L) throw requestTimeout()
    }
}

internal fun requestTimeout(): SocketTimeoutException = SocketTimeoutException("Délai d'opération dépassé")

/** Opération annulée par l'appelant (délai JS ou abandon) : la connexion en vol est coupée. */
class RequestCancelled(message: String = "Opération annulée") : IOException(message)

/**
 * Jeton d'annulation partagé entre l'appelant et la couche réseau.
 *
 * `cancel()` coupe les connexions EN VOL : un `read` bloqué ne rend pas la main
 * au prochain contrôle de boucle. Le jeton reste annulé : toute nouvelle
 * connexion de l'opération échoue avant de partir.
 */
class RequestCancellation {
    @Volatile
    private var cancelled = false

    private val lock = Any()
    private val connections = LinkedHashSet<HttpURLConnection>()
    private val streams = LinkedHashSet<java.io.InputStream>()

    val isCancelled: Boolean get() = cancelled

    fun cancel() {
        cancelled = true
        // Fermer le FLUX d'abord : `disconnect()` seul ne débloque pas toujours
        // un `read` en cours sur `HttpURLConnection` (constaté en test).
        val (activeConns, activeStreams) = synchronized(lock) { connections.toList() to streams.toList() }
        for (stream in activeStreams) {
            try {
                stream.close()
            } catch (_: Exception) {
                // Déjà fermé par le fil de lecture.
            }
        }
        for (conn in activeConns) {
            try {
                conn.disconnect()
            } catch (_: Exception) {
                // Déjà fermée par le fil de lecture.
            }
        }
    }

    fun throwIfCancelled() {
        if (cancelled) throw RequestCancelled()
    }

    internal fun register(conn: HttpURLConnection) {
        synchronized(lock) { connections.add(conn) }
    }

    internal fun unregister(conn: HttpURLConnection) {
        synchronized(lock) { connections.remove(conn) }
    }

    internal fun registerStream(stream: java.io.InputStream) {
        synchronized(lock) { streams.add(stream) }
    }

    internal fun unregisterStream(stream: java.io.InputStream) {
        synchronized(lock) { streams.remove(stream) }
    }
}

/**
 * Jeton de l'opération en cours sur ce fil. Le pont le pose avant `handle` ;
 * `ClientQueue` le REPORTE sur son fil unique (le travail réseau n'y tourne pas).
 */
object RequestScope {
    private val current = ThreadLocal<RequestCancellation?>()

    fun current(): RequestCancellation? = current.get()

    fun <T> with(cancellation: RequestCancellation?, block: () -> T): T {
        val previous = current.get()
        if (cancellation == null) current.remove() else current.set(cancellation)
        try {
            return block()
        } finally {
            if (previous == null) current.remove() else current.set(previous)
        }
    }
}

package fr.veryslopnynotes.data

import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

// Client SSE serveur→app (#15) : GET /v1/events (text/event-stream),
// reconnect exponentiel + états visibles (SseState). Contenu reçu = donnée
// affichée, jamais interprétée (pas d'effet bord via sortie libre).
// ponytail: OkHttp seul (pas d'okhttp-sse), pas de coroutines (callbacks +
// ScheduledExecutor). Upgrade: partage Last-Event-ID si serveur l'ajoute.
sealed interface SseState {
    data object Disconnected : SseState
    data object Connecting : SseState
    data class Connected(val received: Long) : SseState
    data class WaitingRetry(val attempt: Int, val delayMs: Long) : SseState
    data class Failed(val message: String) : SseState
}

// Backoff déterministe (testable) : 1s, 2s, 4s… plafonné 30s.
fun sseBackoffDelayMs(attempt: Int): Long {
    val shift = attempt.coerceIn(0, 5)
    return minOf(30_000L, 1_000L shl shift)
}

// Extrait le JSON après "data:" (ignore commentaires ":" et autres champs).
fun extractSseData(line: String): String? {
    val t = line.trim()
    if (t.isEmpty() || t.startsWith(":")) return null
    if (!t.startsWith("data:")) return null
    return t.removePrefix("data:").trim().ifEmpty { null }
}

interface SseListener {
    fun onState(state: SseState)
    fun onEvent(json: String)
}

class SseClient(
    private val api: ApiClient,
) {
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var call: Call? = null
    @Volatile private var retry: ScheduledFuture<*>? = null
    @Volatile private var closed = true
    private var attempt = 0
    private var received = 0L

    fun eventsRequest(): Request = api.buildGet(EVENTS_PATH)

    fun connect(listener: SseListener) {
        disconnect()
        closed = false
        attempt = 0
        received = 0L
        open(listener)
    }

    fun disconnect() {
        closed = true
        retry?.cancel(false)
        retry = null
        try {
            call?.cancel()
        } catch (_: Exception) {
        }
        call = null
    }

    private fun open(listener: SseListener) {
        if (closed) return
        listener.onState(SseState.Connecting)
        val req = try {
            eventsRequest()
        } catch (e: IllegalArgumentException) {
            listener.onState(SseState.Failed(e.message ?: "URL hors allowlist"))
            return
        }
        val c = api.client().newCall(req)
        call = c
        c.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (closed) return
                scheduleRetry(listener, e.message ?: "réseau indisponible")
            }

            override fun onResponse(call: Call, response: Response) {
                if (closed) {
                    response.close()
                    return
                }
                if (!response.isSuccessful) {
                    response.close()
                    scheduleRetry(listener, "HTTP ${response.code}")
                    return
                }
                attempt = 0
                listener.onState(SseState.Connected(received))
                try {
                    val source = response.body?.source()
                    if (source == null) {
                        response.close()
                        scheduleRetry(listener, "flux vide")
                        return
                    }
                    while (!closed && !source.exhausted()) {
                        val line = try {
                            source.readUtf8Line() ?: break
                        } catch (_: IOException) {
                            break
                        }
                        val data = extractSseData(line) ?: continue
                        received += 1
                        listener.onState(SseState.Connected(received))
                        try {
                            listener.onEvent(data)
                        } catch (_: Exception) {
                        }
                    }
                    response.close()
                    if (!closed) scheduleRetry(listener, "flux fermé")
                } catch (e: Exception) {
                    try {
                        response.close()
                    } catch (_: Exception) {
                    }
                    if (!closed) scheduleRetry(listener, e.message ?: "lecture flux")
                }
            }
        })
    }

    private fun scheduleRetry(listener: SseListener, reason: String) {
        if (closed) return
        attempt += 1
        val delay = sseBackoffDelayMs(attempt)
        listener.onState(SseState.WaitingRetry(attempt, delay))
        retry?.cancel(false)
        retry = scheduler.schedule({
            if (!closed) open(listener)
        }, delay, TimeUnit.MILLISECONDS)
        if (attempt > MAX_ATTEMPTS_BEFORE_FAILED) {
            listener.onState(SseState.Failed(reason))
        }
    }

    companion object {
        const val EVENTS_PATH = "/v1/events"
        private const val MAX_ATTEMPTS_BEFORE_FAILED = 20
    }
}

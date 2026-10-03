package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.ServerConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException

// Resultat refresh reseau avec repli cache (affichage sans reseau).
// Jamais d'exception vers UI : tout echec = Failed avec cache si dispo.
sealed interface RefreshOutcome {
    data class Updated(val payload: String, val fetchedAt: Long) : RefreshOutcome
    data class OfflineFallback(val payload: String, val fetchedAt: Long, val stale: Boolean) : RefreshOutcome
    data class Failed(val message: String, val cachedPayload: String?) : RefreshOutcome
}

// Depots offline-first par ressource cachable.
// Lecture : loadCached() synchrone (jamais de reseau). Ecriture : refreshAsync()
// tente GET serveur allowlist via ApiClient, sauve en cache au succes,
// replie sur cache a l'echec (avion/serveur KO). Invalidation active via
// evenement CacheInvalidated serveur (reason sync/expiry/manual) -> clear().
// I1 : aucun appel hors allowlist serveur ; paths issus de ServerConfig seuls.
class SyncedRepository(
    private val api: ApiClient,
    private val store: CacheStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val main: Handler = Handler(Looper.getMainLooper()),
) {
    fun cached(resource: String): CachedEntry? = store.load(resource)

    fun isStale(resource: String, entry: CachedEntry, now: Long = clock()): Boolean =
        CachePolicy.isStale(resource, entry.fetchedAt, now)

    fun pathFor(resource: String, baseUrl: String): String = when (resource) {
        CachePolicy.GRADES -> ServerConfig.gradesUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/grades" }
        CachePolicy.ASSIGNMENTS -> ServerConfig.assignmentsUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/assignments" }
        CachePolicy.TIMETABLE -> ServerConfig.timetableUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/timetable" }
        CachePolicy.MENUS -> ServerConfig.menusUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/menus" }
        else -> throw IllegalArgumentException("ressource non cachable: $resource")
    }

    // Invalidation active (CacheInvalidated) : purge ressource, UI retombe sur Empty.
    fun invalidate(resource: String) {
        if (CachePolicy.isCacheable(resource)) store.clear(resource)
    }

    // GET serveur async (OkHttp enqueue, pas de coroutines). Callback sur main thread.
    fun refreshAsync(resource: String, baseUrl: String, cb: (RefreshOutcome) -> Unit) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        val request = try {
            api.buildGet(pathFor(resource, baseUrl))
        } catch (e: IllegalArgumentException) {
            post(cb, RefreshOutcome.Failed("URL hors allowlist serveur", store.load(resource)?.payload))
            return
        }
        api.client().newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                val c = store.load(resource)
                if (c != null) {
                    post(cb, RefreshOutcome.OfflineFallback(c.payload, c.fetchedAt, isStale(resource, c)))
                } else {
                    post(cb, RefreshOutcome.Failed("Hors-ligne, aucune donnée en cache.", null))
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        val c = store.load(resource)
                        if (c != null) {
                            post(cb, RefreshOutcome.OfflineFallback(c.payload, c.fetchedAt, isStale(resource, c)))
                        } else {
                            post(cb, RefreshOutcome.Failed("Erreur serveur ${it.code}.", null))
                        }
                        return
                    }
                    val body = it.body?.string()
                    if (body.isNullOrEmpty()) {
                        val c = store.load(resource)
                        post(cb, RefreshOutcome.Failed("Réponse vide.", c?.payload))
                        return
                    }
                    // Contenu serveur = donnee affichee, jamais interpretee (I6/I7).
                    val now = clock()
                    try {
                        store.save(resource, body, now)
                    } catch (_: Exception) {
                        post(cb, RefreshOutcome.Failed("Cache illisible.", body))
                        return
                    }
                    post(cb, RefreshOutcome.Updated(body, now))
                }
            }
        })
    }

    private fun post(cb: (RefreshOutcome) -> Unit, o: RefreshOutcome) {
        try {
            main.post { cb(o) }
        } catch (_: Exception) {
            cb(o)
        }
    }
}

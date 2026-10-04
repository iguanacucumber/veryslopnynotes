package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.ServerConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
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

    // ponytail: query de fenêtre bornée par l appelant (weekStart, #76), vide par
    // défaut = chemin inchangé. Jamais de saisie libre concaténée ici.
    fun pathFor(resource: String, baseUrl: String, query: String = ""): String = when (resource) {
        // #139 : query `algorithm` + `periodId` (sélecteurs de l'onglet Notes).
        CachePolicy.GRADES -> ServerConfig.gradesUrl(baseUrl, query)
            .removePrefix(baseUrl).ifEmpty { "/v1/grades" }
        CachePolicy.ASSIGNMENTS -> ServerConfig.assignmentsUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/assignments" }
        CachePolicy.TIMETABLE -> ServerConfig.timetableUrl(baseUrl, query)
            .removePrefix(baseUrl).ifEmpty { "/v1/timetable" }
        // #78 : évaluations par compétences (compétences fournies sinon vide).
        CachePolicy.EVALUATIONS -> ServerConfig.evaluationsUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/evaluations" }
        CachePolicy.NEWS -> ServerConfig.newsUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/news" }
        CachePolicy.MENUS -> ServerConfig.menusUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/menus" }
        // #77 : vie scolaire (absences/retards + compteurs, sanctions).
        CachePolicy.ATTENDANCE -> ServerConfig.attendanceUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/attendance" }
        CachePolicy.PUNISHMENTS -> ServerConfig.punishmentsUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/punishments" }
        // #87 : onglets actifs de l'etablissement (capacites dynamiques).
        CachePolicy.CAPABILITIES -> ServerConfig.capabilitiesUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/capabilities" }

        // #80 : liste des fils de messagerie (les messages ne sont pas en cache).
        CachePolicy.DISCUSSIONS -> ServerConfig.discussionsUrl(baseUrl)
            .removePrefix(baseUrl).ifEmpty { "/v1/discussions" }
        else -> throw IllegalArgumentException("ressource non cachable: $resource")
    }

    // Invalidation active (CacheInvalidated) : purge ressource, UI retombe sur Empty.
    fun invalidate(resource: String) {
        if (CachePolicy.isCacheable(resource)) store.clear(resource)
    }

    // GET serveur async (OkHttp enqueue, pas de coroutines). Callback sur main thread.
    // ponytail: une seule clé de cache par ressource : la requête de la fenêtre
    //   demandée écrase le payload précédent (semaine courante en pratique).
    //   Upgrade: clé de cache = ressource + fenêtre.
    fun refreshAsync(resource: String, baseUrl: String, query: String = "", cb: (RefreshOutcome) -> Unit) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        val request = try {
            api.buildGet(pathFor(resource, baseUrl, query))
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
                        // 401 : credential d'appareil refusée. Le cache ne masque
                        // PAS une session morte (l'utilisateur verrait des données
                        // périmées comme si tout allait bien) : Failed nu, même
                        // plomberie que les autres échecs, et le garde-fou ApiClient
                        // renvoie vers l'appairage.
                        if (it.code == ApiClient.HTTP_UNAUTHORIZED) {
                            post(cb, RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null))
                            return
                        }
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

    /**
     * #87 : pull-refresh manuel (app -> serveur -> relecture Pronote bornee).
     * POST /v1/sync/refresh : aucune ecriture Pronote, donc pas de confirmation
     * supplementaire (I7 : ce chemin ne declenche aucun LLM). La reponse porte
     * les evenements de sync (types existants) : l'appelant les traite comme
     * une invalidation de cache. accountId absent = serveur mono-compte.
     */
    fun requestSyncRefresh(baseUrl: String, accountId: String = "", cb: (RefreshOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            post(cb, RefreshOutcome.Failed("Serveur non configure.", null))
            return
        }
        val request = try {
            val body = JSONObject().apply {
                if (accountId.isNotBlank()) put("accountId", accountId.trim())
            }.toString().toRequestBody(JSON_MEDIA)
            api.buildPost(ServerConfig.syncRefreshUrl(baseUrl).removePrefix(baseUrl), body)
        } catch (e: IllegalArgumentException) {
            post(cb, RefreshOutcome.Failed("URL hors allowlist serveur", null))
            return
        }
        api.client().newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                post(cb, RefreshOutcome.Failed("Relecture indisponible (hors-ligne).", null))
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val body = it.body?.string()
                    if (!it.isSuccessful || body.isNullOrEmpty()) {
                        post(cb, RefreshOutcome.Failed("Relecture indisponible (HTTP ${it.code}).", null))
                        return
                    }
                    // Contenu serveur = donnee consommee comme invalidation,
                    // jamais interpretee (I6/I7).
                    post(cb, RefreshOutcome.Updated(body, clock()))
                }
            }
        })
    }

    /**
     * #139 : lecture des TRANCHES de l'établissement (`GET /v1/periods`), premier
     * appel à cette route depuis l'app (le sélecteur de période de l'onglet
     * Notes).
     *
     * Volontairement HORS cache : `/v1/periods` n'est pas dans
     * `CACHEABLE_RESOURCES` (shared/contracts/cache.ts), donc l'ajouter ici
     * reviendrait à modifier un contrat partagé pour une liste qui change une
     * fois par an. On rend donc le même [RefreshOutcome] que le reste, mais sans
     * écriture disque : `Updated` = payload lu, `Failed` = le message réel.
     *
     * Jamais d'exception vers l'UI, même Plomberie que `refreshAsync` sur un 401 :
     * le signal de session morte reste levé par `ApiClient`, jamais ici.
     */
    fun fetchPeriods(baseUrl: String, cb: (RefreshOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            post(cb, RefreshOutcome.Failed("Serveur non configure.", null))
            return
        }
        val request = try {
            api.buildGet(ServerConfig.periodsUrl(baseUrl).removePrefix(baseUrl))
        } catch (e: IllegalArgumentException) {
            post(cb, RefreshOutcome.Failed("URL hors allowlist serveur", null))
            return
        }
        api.client().newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                post(cb, RefreshOutcome.Failed("Hors-ligne, tranches indisponibles.", null))
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val body = it.body?.string()
                    if (!it.isSuccessful) {
                        post(
                            cb,
                            RefreshOutcome.Failed(
                                if (it.code == ApiClient.HTTP_UNAUTHORIZED) DeviceAuth.REJECTED_MESSAGE else "Erreur serveur ${it.code}.",
                                null,
                            ),
                        )
                        return
                    }
                    if (body.isNullOrEmpty()) {
                        post(cb, RefreshOutcome.Failed("Réponse vide.", null))
                        return
                    }
                    post(cb, RefreshOutcome.Updated(body, clock()))
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

// #87 : corps JSON du pull-refresh (application/json, stdlib + OkHttp).
private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

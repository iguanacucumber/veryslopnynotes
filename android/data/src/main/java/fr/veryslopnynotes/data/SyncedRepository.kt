package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.SecurityAlert
import org.json.JSONObject

// Resultat refresh reseau avec repli cache (affichage sans reseau).
// Jamais d'exception vers UI : tout echec = Failed avec cache si dispo.
sealed interface RefreshOutcome {
    data class Updated(val payload: String, val fetchedAt: Long) : RefreshOutcome
    data class OfflineFallback(val payload: String, val fetchedAt: Long, val stale: Boolean) : RefreshOutcome
    data class Failed(val message: String, val cachedPayload: String?) : RefreshOutcome
}

// Depots offline-first par ressource cachable (#205, ADR-003).
// Lecture : loadCached() synchrone (jamais de reseau). Ecriture : refreshAsync()
// lit le CLIENT LOCAL (tache de fond, jamais le thread UI), sauve en cache au
// succes, replie sur le cache a l'echec (avion/session KO). `baseUrl` reste un
// parametre des signatures (les ecrans le passent) mais ne sert plus : aucune
// requete serveur metier ne part d'ici. Invalidation active via
// evenement local -> clear().
// I1 : aucun appel hors telephone ; seul `android/pronote/` parle au serveur
// de l'etablissement, via le client tenu par [PronoteSession] (#206 le remplit).
class SyncedRepository(
    private val store: CacheStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val main: Handler = Handler(Looper.getMainLooper()),
    private val provider: PronoteClientProvider = { PronoteSession.client },
) {
    fun cached(resource: String): CachedEntry? = store.load(resource)

    fun isStale(resource: String, entry: CachedEntry, now: Long = clock()): Boolean =
        CachePolicy.isStale(resource, entry.fetchedAt, now)

    // Invalidation active : purge ressource, UI retombe sur Empty.
    fun invalidate(resource: String) {
        if (CachePolicy.isCacheable(resource)) store.clear(resource)
    }

    // Lecture locale async (Thread de fond, pas de coroutines). Callback sur main
    // thread. Le payload ecrit le cache (fenetre demandee, comme avant).
    // ponytail: une seule clé de cache par ressource : la requête de la fenêtre
    //   demandée écrase le payload précédent (semaine courante en pratique).
    //   Upgrade: clé de cache = ressource + fenêtre.
    fun refreshAsync(resource: String, baseUrl: String, query: String = "", cb: (RefreshOutcome) -> Unit) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        readAsync(save = true, resource = resource, query = query, cb = cb)
    }

    /**
     * Lecture locale SANS ecriture cache (semaines non courantes : l'ecran
     * Devoirs/EDT affiche une autre semaine sans ecraser la courante, comme
     * l'ancien GET fenetre qui ne persistait pas).
     */
    fun fetchAsync(resource: String, query: String = "", cb: (RefreshOutcome) -> Unit) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        readAsync(save = false, resource = resource, query = query, cb = cb)
    }

    private fun readAsync(save: Boolean, resource: String, query: String, cb: (RefreshOutcome) -> Unit) {
        Thread {
            val outcome = try {
                val payload = readLocal(resource, query)
                if (save) {
                    try {
                        store.save(resource, payload, clock())
                    } catch (_: Exception) {
                        post(cb, RefreshOutcome.Failed("Cache illisible.", payload))
                        return@Thread
                    }
                    post(cb, RefreshOutcome.Updated(payload, clock()))
                } else {
                    post(cb, RefreshOutcome.Updated(payload, clock()))
                }
            } catch (e: NoLocalSession) {
                post(cb, cachedOrFailed(resource, "Aucune donnée en cache."))
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    // Session locale morte : le cache ne masque PAS une session
                    // morte (des donnees perimees comme si tout allait bien) :
                    // Failed nu, et le signal renvoie vers l'appairage (#113).
                    DeviceAuth.reject()
                    post(cb, RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null))
                } else {
                    post(cb, cachedOrFailed(resource, "Aucune donnée en cache."))
                }
            }
        }.start()
    }

    private fun cachedOrFailed(resource: String, message: String): RefreshOutcome {
        val c = try {
            store.load(resource)
        } catch (_: Exception) {
            null
        }
        return if (c != null) {
            RefreshOutcome.OfflineFallback(c.payload, c.fetchedAt, isStale(resource, c))
        } else {
            RefreshOutcome.Failed(message, null)
        }
    }

    /**
     * #87 : relecture manuelle : aucun effet metier, donc pas de confirmation
     * supplementaire (I7 : ce chemin ne declenche aucun LLM). Localement =
     * ping de session (`keepAlive`) : vivante = l'appelant recharge ses
     * ressources, morte = signal d'appairage.
     */
    fun requestSyncRefresh(baseUrl: String, accountId: String = "", cb: (RefreshOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            post(cb, RefreshOutcome.Failed("Serveur non configure.", null))
            return
        }
        Thread {
            val client = try {
                provider()
            } catch (_: Exception) {
                null
            }
            if (client == null) {
                post(cb, RefreshOutcome.Failed("Relecture indisponible.", null))
                return@Thread
            }
            try {
                client.keepAlive().pingIfDue()
                // Contenu local = invalidation, jamais interprete (I6/I7).
                post(cb, RefreshOutcome.Updated("{\"synced\":true}", clock()))
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    DeviceAuth.reject()
                    post(cb, RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null))
                } else {
                    post(cb, RefreshOutcome.Failed("Relecture indisponible.", null))
                }
            }
        }.start()
    }

    /**
     * Tranches de l'etablissement, lues sur le client local.
     *
     * Volontairement HORS cache (comme avant) : `/v1/periods` n'est pas dans
     * les ressources cachables, donc pas d'ecriture disque : `Updated` = payload
     * lu, `Failed` = le message réel. Jamais d'exception vers l'UI.
     */
    fun fetchPeriods(baseUrl: String, cb: (RefreshOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            post(cb, RefreshOutcome.Failed("Serveur non configure.", null))
            return
        }
        Thread {
            val client = try {
                provider()
            } catch (_: Exception) {
                null
            }
            if (client == null) {
                post(cb, RefreshOutcome.Failed("Tranches indisponibles.", null))
                return@Thread
            }
            try {
                post(cb, RefreshOutcome.Updated(periodsPayload(client), clock()))
            } catch (e: Exception) {
                if (isSessionFailure(e)) {
                    DeviceAuth.reject()
                    post(cb, RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null))
                } else {
                    post(cb, RefreshOutcome.Failed("Tranches indisponibles.", null))
                }
            }
        }.start()
    }

    /**
     * Lecture d'une ressource sur le client local. `null` = pas de session
     * ([NoLocalSession] : repli cache, comme un reseau KO).
     */
    private fun readLocal(resource: String, query: String): String {
        val client = try {
            provider()
        } catch (_: Exception) {
            null
        } ?: throw NoLocalSession()
        val q = parseQuery(query)
        return when (resource) {
            CachePolicy.GRADES -> gradesPayload(client, q)
            CachePolicy.ASSIGNMENTS -> assignmentsPayload(client, q)
            CachePolicy.TIMETABLE -> timetablePayload(client, q)
            CachePolicy.NEWS -> newsPayload(client)
            CachePolicy.MENUS -> menusPayload(client)
            CachePolicy.ATTENDANCE -> attendancePayload(client)
            CachePolicy.PUNISHMENTS -> punishmentsPayload(client)
            CachePolicy.CAPABILITIES -> capabilitiesPayload(client)
            CachePolicy.DISCUSSIONS -> discussionsPayload(client)
            // Alertes : balayage des contenus DEJA en cache (aucun reseau :
            // marche hors ligne, frais = « verifie, rien trouve »).
            CachePolicy.SECURITY_ALERTS -> alertsPayload(scanTexts())
            else -> throw IllegalArgumentException("ressource non cachable: $resource")
        }
    }

    private fun scanTexts(): List<SecurityAlert.ScannableText> {
        val out = mutableListOf<SecurityAlert.ScannableText>()
        for (resource in listOf(CachePolicy.NEWS, CachePolicy.ASSIGNMENTS, CachePolicy.DISCUSSIONS)) {
            val payload = try {
                store.load(resource)?.payload
            } catch (_: Exception) {
                null
            } ?: continue
            val source = when (resource) {
                CachePolicy.NEWS -> "news"
                CachePolicy.ASSIGNMENTS -> "homework"
                else -> "discussions"
            }
            try {
                val root = JSONObject(payload)
                val key = when (resource) {
                    CachePolicy.NEWS -> "news"
                    CachePolicy.ASSIGNMENTS -> "assignments"
                    else -> "discussions"
                }
                val arr = root.optJSONArray(key) ?: continue
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    for (field in listOf("body", "description", "subject", "title")) {
                        val text = o.optString(field, "")
                        if (text.isNotBlank()) out.add(SecurityAlert.ScannableText(source, text))
                    }
                }
            } catch (_: Exception) {
                continue
            }
        }
        return out
    }

    private fun post(cb: (RefreshOutcome) -> Unit, o: RefreshOutcome) {
        try {
            main.post { cb(o) }
        } catch (_: Exception) {
            cb(o)
        }
    }
}

/** Pas de session locale : repli cache, exactement comme un reseau KO. */
private class NoLocalSession : Exception()

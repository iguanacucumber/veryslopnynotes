package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.pronote.RateLimitedError
import org.json.JSONObject

// Jamais d'exception vers l'UI : tout échec = Failed, avec le cache si dispo.
sealed interface RefreshOutcome {
    data class Updated(val payload: String, val fetchedAt: Long) : RefreshOutcome
    data class OfflineFallback(val payload: String, val fetchedAt: Long, val stale: Boolean) : RefreshOutcome
    data class Failed(val message: String, val cachedPayload: String?) : RefreshOutcome
}

// Dépôts offline-first (ADR-003). Lecture : `loadCached()` synchrone, jamais de
// réseau. Écriture : `refreshAsync()` lit le client local en tâche de fond,
// sauve au succès, replie sur le cache à l'échec. `baseUrl` reste dans les
// signatures mais ne sert plus : aucune requête métier ne part d'ici.
// I1 : seul `android/pronote/` parle à l'établissement, via [PronoteSession].
// L'écriture du cache est gardée par l'epoch de session : une déconnexion
// pendant la lecture annule l'écriture (la purge reste effective).
class SyncedRepository(
    private val store: CacheStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val main: Handler = Handler(Looper.getMainLooper()),
    private val provider: PronoteClientProvider = { PronoteSession.client },
) {
    // File PARTAGÉE : un appel client à la fois dans le process, écrans et job
    // de fond compris. Le client local est mutable (refresh() réassigne son
    // état) : deux lectures concurrentes = course et login en double.

    fun cached(resource: String, query: String): CachedEntry? = store.load(resource, query)

    fun payloads(resource: String): List<String> = store.payloads(resource)

    fun isStale(resource: String, entry: CachedEntry, now: Long = clock()): Boolean =
        CachePolicy.isStale(resource, entry.fetchedAt, now)

    // Invalidation active : purge la ressource, l'UI retombe sur Empty.
    fun invalidate(resource: String) {
        CachePolicy.invalidateAfterWrite(store, resource)
    }

    // Une entrée FRAÎCHE est servie telle quelle, sans lire le client local
    // (`force = false`). `force = true` est réservé aux gestes explicites
    // (tirage, « Actualiser », changement de fenêtre/période/algorithme).
    // Le cache est annoncé avec SON age (`fetchedAt`), jamais daté de maintenant.
    //
    // ponytail: entrée par requête (ressource + requête) — pas de cache-hit
    //   qui servirait la semaine précédente.
    fun refreshAsync(
        resource: String,
        baseUrl: String,
        query: String = "",
        force: Boolean = false,
        cb: (RefreshOutcome) -> Unit,
    ) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        val entry = try {
            store.load(resource, query)
        } catch (_: Exception) {
            null
        }
        // L'entrée ne sert que si elle vient de la MÊME requête ; le magasin
        // garde une entrée par requête, donc revenir sur une requête déjà vue
        // est un cache-hit sans réseau.
        if (entry != null && !CachePolicy.shouldFetch(entry, resource, query, clock(), force)) {
            post(cb, RefreshOutcome.Updated(entry.payload, entry.fetchedAt))
            return
        }
        readAsync(save = true, resource = resource, query = query, cb = cb)
    }

    /**
     * Lecture locale SANS écriture cache : une semaine non courante ne doit
     * pas écraser l'entrée de la semaine courante.
     */
    fun fetchAsync(resource: String, query: String = "", cb: (RefreshOutcome) -> Unit) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        readAsync(save = false, resource = resource, query = query, cb = cb)
    }

    private fun readAsync(save: Boolean, resource: String, query: String, cb: (RefreshOutcome) -> Unit) {
        // Clé de dédoublonnage : ressource|query|écriture. Deux lectures
        // identiques en vol = une seule exécution, le MÊME RefreshOutcome
        // pour tous les callbacks.
        //
        // L'ÉCRITURE fait partie de la clé : sinon une lecture sans écriture
        // (l'assistant) pouvait avaler l'écriture du cache de la même requête.
        ClientQueue.submit(
            CachePolicy.dedupKey(resource, query, save),
            work = { readOutcome(save, resource, query) },
            deliver = { o ->
                // L'échec de la file est un outcome : la promesse est toujours
                // réglée, jamais laissée en attente du délai natif.
                post(cb, o.orFailed(RefreshOutcome.Failed("Lecture impossible.", null)))
            },
        )
    }

    /** Corps de lecture (jamais d'exception qui s'echappe : tout echec = outcome). */
    private fun readOutcome(save: Boolean, resource: String, query: String): RefreshOutcome {
        // Époque capturée AVANT la lecture locale : une déconnexion pendant la
        // lecture invalide l'écriture, sinon elle annule la purge du cache.
        val epoch = SessionEpoch.current()
        return try {
            val payload = readLocal(resource, query)
            if (save) {
                // Gardée par l'epoch : `null` = session changée, le payload est
                // abandonné et rien n'est écrit.
                val written = SessionEpoch.writeIfCurrent(epoch) {
                    try {
                        store.save(resource, payload, clock(), query)
                        true
                    } catch (_: Exception) {
                        false
                    }
                }
                when {
                    written == null -> RefreshOutcome.Failed("Session déconnectée.", null)
                    written == false -> RefreshOutcome.Failed("Cache illisible.", payload)
                    else -> RefreshOutcome.Updated(payload, clock())
                }
            } else {
                RefreshOutcome.Updated(payload, clock())
            }
        } catch (e: NoLocalSession) {
            cachedOrFailed(resource, query, "Aucune donnée en cache.")
        } catch (e: RateLimitedError) {
            // Débit limité, pas une panne ni une session morte : le cache est
            // servi et le payload partiel n'a pas été écrit (il a LEVÉ).
            cachedOrFailed(
                resource,
                query,
                "L'établissement limite les connexions : attends une ou deux minutes, puis réessaie.",
            )
        } catch (e: Throwable) {
            // `Throwable` et non `Exception` : un `Error` (OOM) ne doit pas
            // remonter libre, l'écran perdrait le repli cache.
            if (isSessionFailure(e)) {
                // Le cache ne masque pas une session morte : Failed nu, pour
                // renvoyer vers l'appairage.
                DeviceAuth.reject()
                RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null)
            } else {
                cachedOrFailed(resource, query, "Aucune donnée en cache.")
            }
        }
    }

    // Repli cache : seule une entrée de la MÊME requête est servie — celle
    // d'une autre semaine afficherait un écran vide sans le dire.
    private fun cachedOrFailed(resource: String, query: String, message: String): RefreshOutcome {
        val c = try {
            store.load(resource, query)
        } catch (_: Exception) {
            null
        }
        val same = c?.takeIf { CachePolicy.normalizeQuery(it.query) == CachePolicy.normalizeQuery(query) }
        return if (same != null) {
            RefreshOutcome.OfflineFallback(same.payload, same.fetchedAt, isStale(resource, same))
        } else {
            RefreshOutcome.Failed(message, null)
        }
    }

    /**
     * Relecture manuelle : aucun effet métier (I7 : pas de LLM). Localement,
     * ping de session FORCÉ : vivante = l'appelant recharge, morte = signal
     * d'appairage.
     */
    fun requestSyncRefresh(baseUrl: String, accountId: String = "", cb: (RefreshOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            post(cb, RefreshOutcome.Failed("Serveur non configure.", null))
            return
        }
        // Relectures simultanées = un seul ping (clé sans query, indépendante
        // de l'écran) ; tous les callbacks reçoivent le même outcome.
        ClientQueue.submit(
            "sync|",
            work = { syncOutcome() },
            deliver = { o -> post(cb, o.orFailed(RefreshOutcome.Failed("Relecture indisponible.", null))) },
        )
    }

    private fun syncOutcome(): RefreshOutcome {
        val client = try {
            provider()
        } catch (_: Exception) {
            null
        }
        if (client == null) return RefreshOutcome.Failed("Relecture indisponible.", null)
        return try {
            // Ping MANUEL forcé : `pingIfDue` ne partirait jamais ici (la
            // lecture vient de rafraîchir `lastPing`), une session morte
            // passerait pour vivante et aucun re-appairage ne serait proposé.
            client.keepAlive().ping()
            // Contenu local = invalidation, jamais interprete (I6/I7).
            RefreshOutcome.Updated("{\"synced\":true}", clock())
        } catch (e: Exception) {
            if (isSessionFailure(e)) {
                DeviceAuth.reject()
                RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null)
            } else {
                RefreshOutcome.Failed("Relecture indisponible.", null)
            }
        }
    }

    /**
     * Corps d'une actualité : lu À LA DEMANDE (au dépliage), jamais mis en
     * cache — un POST par actualité dépliée, pas vingt par écran. Le corps
     * reste une donnée (texte brut), jamais du HTML (I6). Une session morte
     * est un échec piégé, pour que l'écran propose l'appairage.
     */
    fun fetchNewsBody(id: String, cb: (String?, String?) -> Unit) {
        val target = id.trim()
        if (target.isEmpty()) {
            postBody(cb, null to "Actualité introuvable.")
            return
        }
        ClientQueue.submit(
            "news-body|$target",
            work = { newsBodyOutcome(target) },
            deliver = { o -> postBody(cb, o.orFailed(null to "Contenu indisponible.")) },
        )
    }

    private fun newsBodyOutcome(id: String): Pair<String?, String?> {
        val client = try {
            provider()
        } catch (_: Exception) {
            null
        } ?: return null to "Connexion indisponible."
        return try {
            client.informationContent(id) to null
        } catch (e: Exception) {
            if (isSessionFailure(e)) {
                DeviceAuth.reject()
                null to DeviceAuth.REJECTED_MESSAGE
            } else {
                null to "Contenu indisponible."
            }
        }
    }

    private fun postBody(cb: (String?, String?) -> Unit, o: Pair<String?, String?>) {
        try {
            main.post { cb(o.first, o.second) }
        } catch (_: Exception) {
            cb(o.first, o.second)
        }
    }

    /**
     * Tranches de l'établissement, hors cache : `/v1/periods` n'est pas
     * cachable, donc pas d'écriture disque. Jamais d'exception vers l'UI.
     */
    fun fetchPeriods(baseUrl: String, cb: (RefreshOutcome) -> Unit) {
        if (baseUrl.isBlank()) {
            post(cb, RefreshOutcome.Failed("Serveur non configure.", null))
            return
        }
        ClientQueue.submit(
            "periods|",
            work = { periodsOutcome() },
            deliver = { o -> post(cb, o.orFailed(RefreshOutcome.Failed("Tranches indisponibles.", null))) },
        )
    }

    private fun periodsOutcome(): RefreshOutcome {
        val client = try {
            provider()
        } catch (_: Exception) {
            null
        }
        if (client == null) return RefreshOutcome.Failed("Tranches indisponibles.", null)
        return try {
            RefreshOutcome.Updated(periodsPayload(client), clock())
        } catch (e: Exception) {
            if (isSessionFailure(e)) {
                DeviceAuth.reject()
                RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null)
            } else {
                RefreshOutcome.Failed("Tranches indisponibles.", null)
            }
        }
    }

    /**
     * Lecture d'une ressource sur le client local. `null` = pas de session
     * ([NoLocalSession] : repli cache, comme un réseau KO). La lecture passe
     * par `cachedRead` (porte unique), exécutée dans la file partagée.
     */
    private fun readLocal(resource: String, query: String): String {
        val client = try {
            provider()
        } catch (_: Exception) {
            null
        } ?: throw NoLocalSession()
        // Alertes : balayage des contenus DÉJÀ en cache, aucun réseau (marche
        // hors ligne) — ce n'est pas une lecture du client.
        if (resource == CachePolicy.SECURITY_ALERTS) return alertsPayload(scanTexts())
        return cachedRead(client, resource, query)
    }

    private fun scanTexts(): List<SecurityAlert.ScannableText> {
        val out = mutableListOf<SecurityAlert.ScannableText>()
        for (resource in listOf(CachePolicy.NEWS, CachePolicy.ASSIGNMENTS, CachePolicy.DISCUSSIONS)) {
            // Une ressource a une entrée par requête : on lit TOUTES les
            // entrées, une semaine oubliée ne doit pas échapper à l'alerte.
            val payloads = try {
                store.payloads(resource)
            } catch (_: Exception) {
                emptyList()
            }
            val source = when (resource) {
                CachePolicy.NEWS -> "news"
                CachePolicy.ASSIGNMENTS -> "homework"
                else -> "discussions"
            }
            for (payload in payloads) {
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

/**
 * L'échec de la file est une VALEUR livrée à tous les callbacks de la clé :
 * l'écran affiche son message au lieu d'attendre une promesse pendante.
 */
private fun <T> QueueOutcome<T>.orFailed(fallback: T): T = when (this) {
    is QueueOutcome.Ok -> value
    is QueueOutcome.Failed -> fallback
}

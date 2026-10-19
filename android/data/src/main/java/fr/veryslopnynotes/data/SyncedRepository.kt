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
// #364 : l'ecriture du cache est gardee par l'epoch de session : une
// deconnexion survenue pendant la lecture annule l'ecriture (la purge reste
// effective, le cache du compte deconnecte ne ressuscite pas).
class SyncedRepository(
    private val store: CacheStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val main: Handler = Handler(Looper.getMainLooper()),
    private val provider: PronoteClientProvider = { PronoteSession.client },
) {
    // File d'attente unique (#310) : UN appel client a la fois, dans l'ordre
    // d'arrivee. Le client local est mutable (refresh() reassigne son etat) :
    // deux lectures concurrentes = course et login en double.
    private val queue = LocalRequestQueue<RefreshOutcome>()

    fun cached(resource: String): CachedEntry? = store.load(resource)

    fun isStale(resource: String, entry: CachedEntry, now: Long = clock()): Boolean =
        CachePolicy.isStale(resource, entry.fetchedAt, now)

    // Invalidation active : purge ressource, UI retombe sur Empty.
    // Même règle que l'écriture confirmée (`CachePolicy.invalidateAfterWrite`).
    fun invalidate(resource: String) {
        CachePolicy.invalidateAfterWrite(store, resource)
    }

    // Lecture locale async (file d'attente unique #310 : un seul fil daemon,
    // ordre d'arrivee). Callback sur main thread. Le payload ecrit le cache
    // (fenetre demandee, comme avant).
    //
    // #311 : une entree de cache FRAICHE est servie telle quelle, sans lire le
    // client local (`force = false`, la premiere entree sur un ecran). La salve
    // de POST n'est donc plus refaite a chaque passage d'onglet ; `force = true`
    // est reserve aux GESTES explicites (tirail, « Actualiser », changement de
    // fenetre/periode/algorithme). Le cache est annonce avec SON age
    // (`fetchedAt`) : jamais un `Updated` daté de maintenant, qui ferait passer
    // une donnee ancienne pour fraiche (le badge « perime » reste juste).
    //
    // ponytail: une seule clé de cache par ressource : l'entrée porte la
    //   requête qui l'a produite, donc une autre requête = une autre réponse
    //   (⇒ relecture, pas un cache-hit qui servirait la semaine précédente).
    //   Upgrade: une entrée PAR requête (clé de cache = ressource + requête).
    fun refreshAsync(
        resource: String,
        baseUrl: String,
        query: String = "",
        force: Boolean = false,
        cb: (RefreshOutcome) -> Unit,
    ) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        val entry = try {
            store.load(resource)
        } catch (_: Exception) {
            null
        }
        // #365 : l'entrée ne sert que si elle vient de la MÊME requête ; sinon
        // elle est ABSENTE (semaine / période / algorithme différents).
        if (entry != null && !CachePolicy.shouldFetch(entry, resource, query, clock(), force)) {
            post(cb, RefreshOutcome.Updated(entry.payload, entry.fetchedAt))
            return
        }
        readAsync(save = true, resource = resource, query = query, cb = cb)
    }

    /**
     * Lecture locale SANS ecriture cache (semaines non courantes : l'ecran
     * Devoirs/EDT affiche une autre semaine sans ecraser la courante, comme
     * l'ancien GET fenetre qui ne persistait pas).
     *
     * #365 : coherente avec le reste — le repli cache ne sert qu'une entrée de
     * la MEME requete, et rien n'est ecrit (l'entree de l'autre semaine reste
     * celle qui a produit son payload).
     */
    fun fetchAsync(resource: String, query: String = "", cb: (RefreshOutcome) -> Unit) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        readAsync(save = false, resource = resource, query = query, cb = cb)
    }

    private fun readAsync(save: Boolean, resource: String, query: String, cb: (RefreshOutcome) -> Unit) {
        // Cle de dedoublonnage : ressource|query. Deux lectures identiques EN VOL
        // = une seule execution du client, le MEME RefreshOutcome pour tous les
        // callbacks (relayes un par un sur le main thread).
        queue.submit(
            "$resource|$query",
            work = { readOutcome(save, resource, query) },
            deliver = { o -> post(cb, o) },
        )
    }

    /** Corps de lecture (jamais d'exception qui s'echappe : tout echec = outcome). */
    private fun readOutcome(save: Boolean, resource: String, query: String): RefreshOutcome {
        // #364 : epoque capturee AVANT la lecture locale (le client local peut
        // mettre des secondes) : une deconnexion pendant la lecture invalide
        // l'ecriture, sinon la purge du cache etait annulee par cette lecture.
        val epoch = SessionEpoch.current()
        return try {
            val payload = readLocal(resource, query)
            if (save) {
                // Ecriture gardee par l'epoch : `null` = la session a change
                // (deconnexion) -> payload ABANDONNE, rien n'est ecrit sur le
                // disque, la purge reste effective.
                val written = SessionEpoch.writeIfCurrent(epoch) {
                    try {
                        // #365 : l'entree retient la requete qui l'a produite.
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
        } catch (e: Exception) {
            if (isSessionFailure(e)) {
                // Session locale morte : le cache ne masque PAS une session
                // morte (des donnees perimees comme si tout allait bien) :
                // Failed nu, et le signal renvoie vers l'appairage (#113).
                DeviceAuth.reject()
                RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null)
            } else {
                cachedOrFailed(resource, query, "Aucune donnée en cache.")
            }
        }
    }

    // Repli cache : seule une entrée de la MÊME requête est servie (#365) —
    // celle d'une autre semaine afficherait un écran vide sans le dire.
    private fun cachedOrFailed(resource: String, query: String, message: String): RefreshOutcome {
        val c = try {
            store.load(resource)
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
        // Relectures simultanees = UN seul ping (cle sans query : la requete ne
        // depend d'aucun ecran) ; tous les callbacks recoivent le meme outcome.
        queue.submit("sync|", work = { syncOutcome() }, deliver = { o -> post(cb, o) })
    }

    private fun syncOutcome(): RefreshOutcome {
        val client = try {
            provider()
        } catch (_: Exception) {
            null
        }
        if (client == null) return RefreshOutcome.Failed("Relecture indisponible.", null)
        return try {
            client.keepAlive().pingIfDue()
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
        // Dédoublonnage (#310) : deux écrans qui demandent les tranches en meme
        // temps declenchent UNE lecture locale, pas deux.
        queue.submit("periods|", work = { periodsOutcome() }, deliver = { o -> post(cb, o) })
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

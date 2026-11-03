package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.ClientOptions
import fr.veryslopnynotes.pronote.QrCode
import fr.veryslopnynotes.pronote.QrLoginOptions
import java.io.IOException
import java.util.UUID
import org.json.JSONObject

// `login`/`jeton` sont chiffrés par le PIN ; `url` porte l'adresse de
// l'établissement, seule source (aucune saisie).
// `toString()` masque les champs chiffrés : rien dans un rapport de crash.
data class SchoolQr(
    val login: String,
    val jeton: String,
    val url: String,
) {
    override fun toString(): String = "SchoolQr(login=***, jeton=***, url=$url)"
}

/** Saisie avant envoi : aucun identifiant n'est saisi ni stocké. `toString()` masque le PIN. */
data class PairingInput(
    val qr: SchoolQr? = null,
    val pin: String = "",
) {
    override fun toString(): String = "PairingInput(qr=$qr, pin=***)"
}

/** Sortie de l'appairage local, avec un message prêt à afficher pour chaque refus. */
sealed interface PairingResult {
    /** [accountId] = id de la ressource client (pas le login) ; `null` = inconnu. */
    data class Ok(val accountId: String?) : PairingResult
    data class Err(val code: String, val message: String) : PairingResult
}

/** Sortie de la restauration au démarrage (store chiffré → client local). */
sealed interface RestoreResult {
    data object Restored : RestoreResult
    data object NoSession : RestoreResult
    /** Jeton mort (tourné, révoqué) : le store est vidé ; `sessionCleared` dit si le disque a suivi. */
    data class Dead(val message: String, val sessionCleared: Boolean = true) : RestoreResult
    /** Réseau KO : le store est GARDÉ (session vivante), l'app lit ses caches. */
    data object Offline : RestoreResult
}

// Appairage 100 % sur l'appareil (ADR-003) : QR + PIN ouvrent la session
// directement via `android/pronote/`, sans serveur. Le PIN déchiffre
// `login`/`jeton` sur le téléphone et n'est ni persisté, ni journalisé, ni
// dans un message d'erreur. Bloquant : jamais sur le thread UI. I1 : seul
// `android/pronote/` parle à l'établissement.
//
// Le cache appartient à UN compte : un appairage d'un AUTRE compte, ou une
// session morte, purge le cache (sinon un écran hors ligne sert l'ancien
// payload jusqu'à 24 h). La purge précède la publication du client, et les
// deux sont atomiques : publier d'abord laissait une fenêtre où le cache
// servait encore l'ancien compte.
class PairingRepository(
    private val sessions: SessionStore,
    private val cacheStore: CacheStore,
    private val provider: PronoteClientProvider = { PronoteSession.client },
    /** Enregistré DANS la section critique, avec la session (bascule atomique). */
    private val accountRecorder: AccountRecorder = AccountRecorder { WriteResult.Written },
) {
    /** Le `uuid` identifie CET appareil (2e tour 2FA), persisté avec la session. */
    fun pairBlocking(input: PairingInput, deviceName: String = "", uuid: String = newUuid()): PairingResult =
        // Même file ET même verrou que la restauration : deux `tokenLogin` en
        // parallèle sur le même compte = erreur 25, et l'établissement LIMITE
        // le compte. Ordre unique : file -> session.
        queuedPairing("auth|pair|") { SessionGate.serialized { pairLocked(input, deviceName, uuid) } }

    /** Corps de l'appairage, exécuté DANS la file et sous le verrou de session. */
    private fun pairLocked(input: PairingInput, deviceName: String, uuid: String): PairingResult {
        val qr = input.qr
        val pin = input.pin.trim()
        if (qr == null || pin.isEmpty()) {
            return PairingResult.Err("bad_request", "QR de l'établissement et son PIN requis")
        }
        if (pin.length > PIN_MAX_CHARS) {
            return PairingResult.Err("bad_request", "PIN refusé : vérifie le code défini dans ton compte établissement.")
        }
        val schoolUrl = qr.url
        val client = try {
            Client.qrcodeLogin(
                QrCode(login = qr.login, jeton = qr.jeton, url = schoolUrl),
                pin,
                uuid,
                QrLoginOptions(
                    deviceName = deviceName.trim().ifEmpty { null },
                    // Mémo des lectures identiques (60 s) : moins d'appels.
                    memoizeReads = true,
                ),
            )
        } catch (e: IllegalArgumentException) {
            // URL du QR malformée : rescanner est le seul geste utile.
            return PairingResult.Err("bad_request", "QR sans adresse d'établissement valide : rescane le code affiché par son application.")
        } catch (e: Exception) {
            return failure(e)
        }
        return publish(client, SessionMode.JETON, schoolUrl)
    }

    /**
     * Connexion à l'établissement de DÉMONSTRATION : compte public, ouvert par
     * identifiant (pas de jeton). Même file et même verrou : une seule session
     * à la fois.
     */
    fun pairDemoBlocking(): PairingResult =
        queuedPairing("auth|demo|") { SessionGate.serialized { demoLocked() } }

    private fun demoLocked(): PairingResult {
        val client = try {
            Client.demoLogin()
        } catch (_: Exception) {
            // Un seul code pour la démo, et jamais le message brut (il peut
            // nommer l'hôte).
            return PairingResult.Err("demo_failed", "Connexion à la démo impossible : réessaie dans un instant.")
        }
        return publish(client, SessionMode.IDENTIFIANT)
    }

    /**
     * Purge du cache du compte précédent, client en RAM, session persistée et
     * compte courant enregistré — la bascule session + comptes est atomique
     * ([AccountSessionCommit], sous la garde d'époque).
     * La purge précède la publication (`#529`) : les identifiants sont donc
     * exportés avant, la purge ayant besoin de l'identité du nouveau compte.
     * Déstructuré, pas nommé : le champ du port s'appelle `pronoteUrl`
     * (I1 : ce mot ne figure dans aucun identifiant hors `android/pronote/`).
     */
    private fun publish(client: Client, mode: String, schoolUrl: String = ""): PairingResult {
        val (endpoint, username, password, clientId, rebuiltUuid) = try {
            client.exportCredentials()
        } catch (_: Exception) {
            // Client pas encore publié : l'ancien compte reste en place, rien
            // à nettoyer.
            return PairingResult.Err("internal", "Session illisible : réessaie l'appairage.")
        }
        // Id de la ressource client — pas le login, pas le jeton (pas un secret).
        val accountId = try {
            client.infoId?.trim()?.takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        }
        try {
            // L'identité vient de la session PERSISTÉE (toujours présente, pas
            // `AccountStore.current()`). La purge est AVANT l'écriture de la
            // session : si le process meurt entre les deux, la session restaurée
            // est l'ANCIENNE, jamais le nouveau compte avec le cache de l'ancien.
            val previous = try {
                sessions.load()?.let { AccountIdentity.of(it.endpointUrl, it.username) }
            } catch (_: Exception) {
                null
            }
            // Bascule ATOMIQUE : le client du nouveau compte ne devient
            // visible qu'une fois le cache de l'ancien purgé.
            val switched = CacheScope.switchAccount(
                cacheStore,
                previous,
                AccountIdentity.of(endpoint, username),
            ) {
                PronoteSession.set(client)
            }
            if (switched == CacheSwitch.Failed) {
                // Purge incomplète : ni session persistée ni publication,
                // sinon le compte suivant hériterait du cache de l'ancien.
                return PairingResult.Err("cache_not_cleared", "Cache local non purgé : réessaie l'appairage.")
            }
            // Session ET compte dans la même garde d'époque : un logout
            // concurrent refuse la bascule au lieu de la couper en deux. Un
            // échec d'écriture (compte ou session) annule l'appairage ; la
            // session précédente est restaurée si le compte est refusé.
            val written = AccountSessionCommit(sessions, accountRecorder).switchTo(
                StoredSession(
                    endpointUrl = endpoint,
                    username = username,
                    password = password,
                    // Démo : pas d'UUID d'appareil ; le store refuse une session
                    // sans UUID, on en met un au hasard.
                    uuid = rebuiltUuid.ifEmpty { newUuid() },
                    clientIdentifier = clientId,
                    schoolUrl = schoolUrl.ifEmpty { endpoint },
                    mode = mode,
                ),
                accountId,
            )
            if (written is WriteResult.EpochRefused) {
                PronoteSession.clear()
                return PairingResult.Err("session_changed", "Session modifiée pendant l'appairage : réessaie.")
            }
            if (!written.ok) {
                // Rien n'est publié : ni session neuve ni compte à moitié
                // enregistré (l'échec de restauration est porté par le code).
                PronoteSession.clear()
                return PairingResult.Err("storage_unavailable", "Stockage local indisponible : appairage annulé, réessaie.")
            }
        } catch (_: Exception) {
            PronoteSession.clear()
            return PairingResult.Err("internal", "Session illisible : réessaie l'appairage.")
        }
        return PairingResult.Ok(accountId)
    }

    /**
     * Restauration : le jeton persisté rouvre la session sans rescanner ; la
     * démo se rouvre par LOGIN (compte public, pas de jeton).
     *
     * UN SEUL `tokenLogin` à la fois dans le process : le pont et le job de
     * fond restaurent chacun, et deux authentifications parallèles sur le même
     * compte déclenchent l'erreur 25 puis une LIMITE du compte. Le second
     * appelant attend et trouve la session en RAM. Session morte = store vidé
     * et cache purgé ; réseau KO = store gardé.
     */
    fun restoreBlocking(): RestoreResult = queuedRestore { SessionGate.serialized { restoreLocked() } }

    private fun restoreLocked(): RestoreResult {
        val stored = try {
            sessions.load()
        } catch (_: Exception) {
            null
        } ?: return RestoreResult.NoSession
        if (provider() != null) return RestoreResult.Restored
        return try {
            val client = if (SessionMode.of(stored.mode) == SessionMode.IDENTIFIANT) {
                // Démo : couple identifiant / mot de passe public, pas de jeton.
                Client.login(
                    stored.endpointUrl,
                    stored.username,
                    stored.password,
                    // Mémo des lectures identiques (60 s), comme à l'appairage.
                    ClientOptions(clientIdentifier = stored.clientIdentifier, memoizeReads = true),
                )
            } else {
                Client.tokenLogin(
                    stored.endpointUrl,
                    stored.username,
                    stored.password,
                    stored.uuid,
                    // Mémo des lectures identiques (60 s), comme à l'appairage.
                    ClientOptions(clientIdentifier = stored.clientIdentifier, memoizeReads = true),
                )
            }
            PronoteSession.set(client)
            RestoreResult.Restored
        } catch (e: Exception) {
            if (e is IOException || !isSessionFailure(e)) {
                RestoreResult.Offline
            } else {
                // Le store doit disparaître AVANT le cache : une session morte
                // qui survivrait au disque republirait l'ancien compte.
                val cleared = try {
                    sessions.clear()
                } catch (_: Exception) {
                    WriteResult.Failed("session non effacée")
                }
                // Session MORTE : le cache part avec elle, sinon l'appairage
                // suivant (un AUTRE compte) servirait ce payload hors ligne
                // jusqu'à 24 h.
                CacheScope.onSessionDead(cacheStore)
                // `false` = le jeton peut ressusciter au force-stop : le pont
                // PUBLIE cet échec au lieu de dire « déconnecté ».
                RestoreResult.Dead(DeviceAuth.REJECTED_MESSAGE, cleared.ok)
            }
        }
    }

    /**
     * Toute ouverture de session passe par LA file unique : elle est cadencée
     * (seau à jetons, cooldown persistant) comme les lectures. Un travail qui
     * jette livre une cause typée, jamais une attente sans fin.
     */
    private fun queuedPairing(key: String, block: () -> PairingResult): PairingResult {
        val outcome = ClientQueue.submitAndAwait<PairingResult>(key, AUTH_TIMEOUT_MS) { block() }
            ?: return PairingResult.Err(
                PairingFailureCause.SCHOOL_UNREACHABLE.code,
                PairingFailureCause.SCHOOL_UNREACHABLE.message,
            )
        return when (outcome) {
            is QueueOutcome.Ok -> outcome.value
            is QueueOutcome.Failed -> failureOr(outcome.cause)
        }
    }

    /** Une restauration interrompue garde le store : jamais une session effacée. */
    private fun queuedRestore(block: () -> RestoreResult): RestoreResult {
        val outcome = ClientQueue.submitAndAwait<RestoreResult>("auth|restore|", AUTH_TIMEOUT_MS) { block() }
            ?: return RestoreResult.Offline
        return when (outcome) {
            is QueueOutcome.Ok -> outcome.value
            is QueueOutcome.Failed -> RestoreResult.Offline
        }
    }

    private fun failureOr(cause: Throwable): PairingResult.Err =
        if (cause is Exception) {
            failure(cause)
        } else {
            PairingResult.Err("internal", "Appairage impossible : réessaie.")
        }

    /**
     * Déconnexion sous le MÊME verrou que l'appairage et la restauration : une
     * restauration EN VOL ne peut plus publier l'ancien client après la purge.
     * [onPurged] efface l'état qui n'appartient pas au dépôt (liste de comptes)
     * une fois la session et le cache traités, dans la même section critique.
     *
     * Rend l'issue COMBINÉE : session, cache ET comptes. Un échec de l'un
     * n'est jamais un « déconnecté » qui laisse la donnée du compte sur le
     * disque — l'appelant remonte le refus.
     */
    fun logoutBlocking(onPurged: () -> WriteResult = { WriteResult.Written }): WriteResult =
        SessionGate.serialized {
            var sessionWrite: WriteResult = WriteResult.Failed("session non effacée")
            val cachePurged = SessionRepair.purge({ sessionWrite = sessions.clear() }, cacheStore)
            val accountsWrite = onPurged()
            when {
                !sessionWrite.ok -> sessionWrite
                !accountsWrite.ok -> accountsWrite
                !cachePurged -> WriteResult.Failed("cache non purgé")
                else -> WriteResult.Written
            }
        }

    /**
     * Erreur d'appairage → cause typée, puis phrase actionnable. Jamais
     * « recommence » quand « rescane » est la réponse, jamais un message brut
     * de la lib (I6) et jamais une classification par un mot du message.
     */
    private fun failure(e: Exception): PairingResult.Err {
        val cause = pairingFailureCause(e)
        return PairingResult.Err(cause.code, cause.message)
    }

    companion object {
        /** Miroir de SETUP_PIN_MAX_CHARS (shared/contracts/api.ts). */
        const val PIN_MAX_CHARS = 64

        /**
         * Attente maximale d'une ouverture de session dans la file. Au-delà,
         * l'appelant reçoit un échec typé et peut réessayer : aucune promesse
         * du pont ne reste pendante.
         */
        const val AUTH_TIMEOUT_MS = 180_000L

        fun newUuid(): String = UUID.randomUUID().toString()
    }
}

// Miroir de SETUP_* (shared/contracts/api.ts), bornes appliquées à la saisie.
private const val SCHOOL_QR_FIELD_MAX_CHARS = 1024
private const val SCHOOL_URL_MAX_CHARS = 300

/**
 * Contenu scanné → payload du QR. Deux formes : JSON
 * (`{"login":…,"jeton":…,"url":…}`) ou compacte `login|jeton|url`.
 * L'`url` est obligatoire ; un QR sans adresse donne `null` (jamais d'exception).
 */
fun parseSchoolQr(raw: String): SchoolQr? {
    val text = raw.trim()
    if (text.isEmpty()) return null
    if (text.startsWith("{")) {
        return try {
            val o = JSONObject(text)
            val login = o.optString("login", "").trim()
            val jeton = o.optString("jeton", "").trim()
            val url = o.optString("url", "").trim()
            if (!bounded(login) || !bounded(jeton) || !boundedSchoolUrl(url)) null
            else SchoolQr(login, jeton, url)
        } catch (_: Exception) {
            null
        }
    }
    val parts = text.split('|')
    if (parts.size < 3) return null
    val login = parts[0].trim()
    val jeton = parts[1].trim()
    val url = parts[2].trim()
    if (!bounded(login) || !bounded(jeton) || !boundedSchoolUrl(url)) return null
    return SchoolQr(login, jeton, url)
}

private fun bounded(value: String): Boolean =
    value.isNotEmpty() && value.length <= SCHOOL_QR_FIELD_MAX_CHARS

/** Adresse portée par le QR, bornée avant usage (le client revalide). */
private fun boundedSchoolUrl(value: String): Boolean =
    value.isNotEmpty() && value.length <= SCHOOL_URL_MAX_CHARS

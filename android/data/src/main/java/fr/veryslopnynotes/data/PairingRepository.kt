package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.ClientOptions
import fr.veryslopnynotes.pronote.MFAError
import fr.veryslopnynotes.pronote.QRCodeDecryptError
import fr.veryslopnynotes.pronote.QrCode
import fr.veryslopnynotes.pronote.QrLoginOptions
import java.io.IOException
import java.util.UUID
import org.json.JSONObject

// Payload du QR affiché par l'application Pronote (#120). `login` et
// `jeton` sont des blocs chiffrés dont la clé est le PIN : il faut les deux
// pour ouvrir la session, et le PIN est celui défini dans Pronote (pas un
// code imposé par l'app). `url` est l'adresse de l'établissement portée par
// le QR (#299) : c'est la SEULE source, il n'y a plus d'étape de saisie.
//
// `toString()` rédigé : `login`/`jeton` sont des chiffrés, mais ils n'ont
// rien à faire dans un rapport de crash.
data class SchoolQr(
    val login: String,
    val jeton: String,
    val url: String,
) {
    override fun toString(): String = "SchoolQr(login=***, jeton=***, url=$url)"
}

/**
 * Ce que l'utilisateur a rempli à l'écran, avant l'envoi. Le QR et son PIN
 * sont la preuve de détention ET la seule méthode — aucun identifiant n'est
 * saisi ni stocké. Le refus « QR/PIN manquant » est rendu tel quel par l'app.
 *
 * `toString()` rédigé : le PIN en clair dans un rapport de crash, jamais.
 */
data class PairingInput(
    val qr: SchoolQr? = null,
    val pin: String = "",
) {
    override fun toString(): String = "PairingInput(qr=$qr, pin=***)"
}

/** Sortie de l'appairage local, avec un message prêt à afficher pour chaque refus. */
sealed interface PairingResult {
    data class Ok(val schoolUrl: String) : PairingResult
    data class Err(val code: String, val message: String) : PairingResult
}

/** Sortie de la restauration au démarrage (store chiffré → client local). */
sealed interface RestoreResult {
    /** Session reconstruite (`PronoteSession` remplie) : l'app lit le téléphone. */
    data object Restored : RestoreResult
    /** Jamais appairé : l'écran d'appairage est la route de départ. */
    data object NoSession : RestoreResult
    /** Jeton mort (tourné, révoqué) : le store est vidé, cap sur l'appairage. */
    data class Dead(val message: String) : RestoreResult
    /** Réseau KO : le store est GARDÉ (la session n'est pas morte, juste
     * injoignable), l'app lit ses caches. */
    data object Offline : RestoreResult
}

// Appairage 100 % sur l'appareil (#206, ADR-003) : le QR de l'établissement +
// son PIN ouvrent la session Pronote DIRECTEMENT (`Client.qrcodeLogin`, le
// port `android/pronote/`), sans serveur intermédiaire. C'est le QR qui porte
// l'adresse de l'établissement (#299) : plus rien n'est saisi à l'écran. Le PIN
// déchiffre `login`/`jeton` sur le téléphone et n'en sort jamais — il n'est ni
// persisté (voir `SessionStore`), ni journalisé, ni dans un message d'erreur.
//
// Bloquant (réseau Pronote, jamais le thread UI : l'écran file en tâche de
// fond). I1 : seul `android/pronote/` parle au serveur de l'établissement ;
// ce dépôt ne fait que lui passer le QR et ranger la session qui en sort.
// ponytail: pas de sérialisation locale du credential — le jeton va droit
// dans le SessionStore chiffré, comme l'ancien bearer allait dans le TokenStore.
//
// #407 : le dépôt porte le STORE DE CACHE : le cache est la donnée d'UN
// compte, donc un appairage d'un AUTRE compte (ou une session MORTE) purge
// le cache — sinon les écrans Notes/EDT/Cantine/Capacités servent le payload
// du compte précédent, hors ligne, jusqu'à 24 h (TTL des capacités).
class PairingRepository(
    private val sessions: SessionStore,
    private val cacheStore: CacheStore,
    private val provider: PronoteClientProvider = { PronoteSession.client },
) {
    /**
     * Appaire : QR + PIN → session locale + session persistée. Le `uuid`
     * identifie CET appareil auprès de l'établissement (2e tour 2FA) : un par
     * appairage, persisté avec la session (le re-pair en régénère un).
     */
    fun pairBlocking(input: PairingInput, deviceName: String = "", uuid: String = newUuid()): PairingResult {
        // QR + PIN = la seule méthode : sans les deux, pas d'appel réseau (le
        // téléphone refuserait comme l'établissement, en plus lent).
        val qr = input.qr
        val pin = input.pin.trim()
        if (qr == null || pin.isEmpty()) {
            return PairingResult.Err("bad_request", "QR de l'établissement et son PIN requis")
        }
        if (pin.length > PIN_MAX_CHARS) {
            return PairingResult.Err("bad_request", "PIN refusé : vérifie le code défini dans ton compte établissement.")
        }
        // L'adresse vient du QR (#299) : `parseSchoolQr` refuse déjà un QR sans
        // URL, donc elle est là et bornée. Le client la revalide.
        val schoolUrl = qr.url
        val client = try {
            Client.qrcodeLogin(
                QrCode(login = qr.login, jeton = qr.jeton, url = schoolUrl),
                pin,
                uuid,
                QrLoginOptions(deviceName = deviceName.trim().ifEmpty { null }),
            )
        } catch (e: IllegalArgumentException) {
            // URL du QR illisible (URI malformée) : la faute est dans le code
            // scanné, donc le seul geste utile est de le rescanner.
            return PairingResult.Err("bad_request", "QR sans adresse d'établissement valide : rescane le code affiché par son application.")
        } catch (e: Exception) {
            return failure(e)
        }
        // La session vit en mémoire (lectures) ET sur disque chiffré (redémarrage).
        PronoteSession.set(client)
        try {
            // Déstructuré, pas nommé : le champ du port s'appelle `pronoteUrl`
            // (I1 : ce mot ne figure dans aucun identifiant hors `android/pronote/`).
            val (endpoint, username, password, clientId, rebuiltUuid) = client.exportCredentials()
            // #407 : le compte vient de changer ? Alors le cache du compte
            // précédent part : il ne doit JAMAIS être servi au nouveau compte.
            // L'identité vient de la session PERSISTÉE (toujours présente,
            // contrairement à `AccountStore.current()`) et de celle qu'on
            // appaire maintenant.
            // La purge est AVANT `sessions.save` : si le process meurt entre
            // les deux, la session restaurée est l'ANCIENNE (dont le cache
            // vient d'être purgé), jamais le nouveau compte avec le cache de
            // l'ancien.
            val previous = try {
                sessions.load()?.let { AccountIdentity.of(it.endpointUrl, it.username) }
            } catch (_: Exception) {
                null
            }
            CacheScope.onAccountPaired(
                cacheStore,
                previous,
                AccountIdentity.of(endpoint, username),
            )
            sessions.save(
                StoredSession(
                    endpointUrl = endpoint,
                    username = username,
                    password = password,
                    uuid = rebuiltUuid,
                    clientIdentifier = clientId,
                    schoolUrl = schoolUrl,
                ),
            )
        } catch (_: Exception) {
            PronoteSession.clear()
            return PairingResult.Err("internal", "Session illisible : réessaie l'appairage.")
        }
        return PairingResult.Ok(schoolUrl)
    }

    /**
     * Restauration au démarrage : le jeton persisté rouvre la session SANS
     * rescanner (`Client.tokenLogin`). Session morte = store vidé (un jeton
     * mort ne ressuscitera pas) ET cache purgé (#407) ; réseau KO = store gardé
     * (la session n'est pas morte, l'app lit ses caches).
     *
     * #406 : UN SEUL `tokenLogin` à la fois dans le process. Depuis #406, le
     * job de fond restaure la session lui aussi (process neuf, sans
     * interface) : si le pont et le job restaurent EN PARALLÈLE, deux
     * authentifications partent sur le même compte → « Exceeded max
     * authorization requests » (erreur 25) → l'établissement LIMITE le
     * compte. Le verrou est donc partagé : le second appelant attend, puis
     * trouve la session déjà en RAM (`PronoteSession.client`) et ne refait
     * pas de réseau.
     */
    fun restoreBlocking(): RestoreResult = synchronized(restoreLock) {
        val stored = try {
            sessions.load()
        } catch (_: Exception) {
            null
        } ?: return@synchronized RestoreResult.NoSession
        if (provider() != null) return@synchronized RestoreResult.Restored
        try {
            val client = Client.tokenLogin(
                stored.endpointUrl,
                stored.username,
                stored.password,
                stored.uuid,
                ClientOptions(clientIdentifier = stored.clientIdentifier),
            )
            PronoteSession.set(client)
            RestoreResult.Restored
        } catch (e: Exception) {
            if (e is IOException || !isSessionFailure(e)) {
                RestoreResult.Offline
            } else {
                try {
                    sessions.clear()
                } catch (_: Exception) {
                }
                // #407 : la session est MORTE (jeton tourné) : le cache part
                // avec elle. Sans cette purge, l'appairage suivant — un AUTRE
                // compte — servirait le payload du compte mort, hors ligne,
                // jusqu'à 24 h (TTL des capacités).
                CacheScope.onSessionDead(cacheStore)
                RestoreResult.Dead(DeviceAuth.REJECTED_MESSAGE)
            }
        }
    }

    /**
     * Erreur d'appairage → phrase actionnable. On ne dit jamais « recommence »
     * quand « rescane » est la bonne réponse, et jamais un diagnostic deviné :
     * un message brut de la lib ne sort pas (I6, règle d'or).
     */
    private fun failure(e: Exception): PairingResult.Err {
        if (e is IOException) {
            // Jamais le message de l'exception : il peut nommer l'hôte de
            // l'établissement (adresse interne, port) (#396). Le pont rend la
            // phrase affichée à partir du code.
            return PairingResult.Err("network", "Réseau indisponible : vérifie ta connexion, puis réessaie.")
        }
        val message = e.message.orEmpty()
        return when {
            e is QRCodeDecryptError ->
                PairingResult.Err("qr_rejected", "QR ou PIN refusé par l'établissement : rescane le code affiché par son application.")
            e is MFAError ->
                PairingResult.Err("mfa_required", "Ce compte exige une vérification supplémentaire que l'app ne prend pas en charge.")
            isSessionFailure(e) || message.isNotBlank() && isLoginRefused(message) ->
                PairingResult.Err("login_refused", "Compte refusé par l'établissement : régénère le QR dans son application, puis rescane-le.")
            else ->
                PairingResult.Err("school_unreachable", "L'établissement ne répond pas : réessaie dans un instant.")
        }
    }

    companion object {
        /** Miroir de SETUP_PIN_MAX_CHARS (shared/contracts/api.ts). */
        const val PIN_MAX_CHARS = 64

        /**
         * Verrou de restauration PARTAGÉ par tout le process (#406) : le pont
         * et le job de fond ne doivent jamais ouvrir deux sessions en
         * parallèle (erreur 25 côté établissement).
         */
        private val restoreLock = Any()

        fun newUuid(): String = UUID.randomUUID().toString()
    }
}

/** Message brut qui parle d'identifiants = compte refusé (jamais affiché tel quel). */
private fun isLoginRefused(message: String): Boolean =
    Regex("login|credential|username|password|identifiant|refus", RegexOption.IGNORE_CASE)
        .containsMatchIn(message)

// Miroir de SETUP_* (shared/contracts/api.ts). Bornes appliquées à la saisie :
// l'établissement revalide de son côté.
private const val SCHOOL_QR_FIELD_MAX_CHARS = 1024
private const val SCHOOL_URL_MAX_CHARS = 300

/**
 * Contenu scanné → payload du QR de l'établissement.
 * Deux formes acceptées : le JSON que produit l'application de l'établissement
 * (`{"login":…,"jeton":…,"url":…}`) et la forme compacte `login|jeton|url`.
 * L'`url` est OBLIGATOIRE (#299) : plus d'étape de saisie, donc un QR sans
 * adresse est un QR que l'app ne sait pas utiliser — `null`, l'appelant
 * affiche « QR illisible ». Renvoie `null` plutôt que de lever.
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

/** Adresse portée par le QR, bornée avant usage (le client revalide de son côté). */
private fun boundedSchoolUrl(value: String): Boolean =
    value.isNotEmpty() && value.length <= SCHOOL_URL_MAX_CHARS

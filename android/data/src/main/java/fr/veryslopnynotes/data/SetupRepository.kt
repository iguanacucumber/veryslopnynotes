package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ServerConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

// Payload du QR affiché par l'application Pronote / l'ENT (#120). `login` et
// `jeton` sont des blocs chiffrés dont la clé est le PIN : le serveur les
// transmet tels quels à pronotets (`qrcodeLogin`), il ne les interprète pas.
// `url` n'est pas toujours présent dans le QR — sinon c'est l'URL saisie au
// setup qui fait foi.
data class SchoolQr(
    val login: String,
    val jeton: String,
    val url: String? = null,
)

/**
 * Ce que l'utilisateur a rempli à l'écran, avant l'envoi. Les deux méthodes
 * sont facultatives mais le serveur en exige une : `parseSchoolQr`/`null` côté
 * identifiants, le refus « aucune méthode » est rendu tel quel par l'app.
 */
data class SetupInput(
    val schoolUrl: String,
    val ent: String,
    val username: String = "",
    val password: String = "",
    val qr: SchoolQr? = null,
    val pin: String = "",
)

/** Sortie de POST /v1/setup, avec un message prêt à afficher pour chaque refus. */
sealed interface SetupResult {
    data class Ok(val device: PairedDevice) : SetupResult
    data class Err(val code: String, val message: String) : SetupResult
}

// POST /v1/setup : compte école + jeton de device en UN appel (contrat 0.5.0).
// Route PUBLIQUE comme l'appairage — c'est elle qui rend le secret, donc aucun
// bearer ne doit partir ; on construit donc la Request ici et non via
// `ApiClient.buildPost`. Même allowlist serveur unique (ServerConfig), I1.
// ponytail: pas de sérialisation locale du credential — le secret va droit
// dans le TokenStore chiffré, comme à l'appairage.
class SetupRepository(
    private val api: ApiClient,
) {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    fun setupRequest(deviceName: String, input: SetupInput): Request {
        val body = JSONObject().put("deviceName", deviceName).put("schoolUrl", input.schoolUrl).put("ent", input.ent)
        if (input.username.isNotBlank() && input.password.isNotBlank()) {
            body.put("username", input.username).put("password", input.password)
        }
        input.qr?.let { qr ->
            body.put("qr", JSONObject().put("login", qr.login).put("jeton", qr.jeton))
            if (!qr.url.isNullOrBlank()) body.getJSONObject("qr").put("url", qr.url)
        }
        if (input.pin.isNotBlank()) body.put("pin", input.pin)
        val url = ServerConfig.setupUrl(api.baseUrl)
        require(ServerConfig.isAllowed(url, api.baseUrl)) { "URL hors allowlist serveur" }
        return Request.Builder().url(url).post(body.toString().toRequestBody(jsonMedia)).build()
    }

    /**
     * Un setup réussi = `{ device: { id, tokenHash }, token }`, forme
     * IDENTIQUE à la confirmation d'appairage : on réutilise son parseur
     * (intégrité `sha256(token) == tokenHash` incluse) plutôt que d'en écrire
     * un second qui pourrait diverger.
     */
    fun parseResponse(json: String): PairedDevice? = PairingRepository(api).parseConfirmResponse(json)

    fun runBlocking(deviceName: String, input: SetupInput): SetupResult {
        val schoolUrl = input.schoolUrl.trim()
        if (schoolUrl.isEmpty()) return SetupResult.Err("bad_request", "Adresse de l'établissement absente")
        if (input.ent.isBlank()) return SetupResult.Err("bad_request", "Type d'ENT absent")
        // Aucune méthode exploitable : pas d'appel réseau, refus tout de suite
        // (le serveur ferait la même chose, en plus lent).
        val hasQr = input.qr != null && input.pin.isNotBlank()
        val hasCredentials = input.username.isNotBlank() && input.password.isNotBlank()
        if (!hasQr && !hasCredentials) {
            return SetupResult.Err("bad_request", "Identifiants ou QR de l'établissement requis")
        }
        return try {
            api.client().newCall(setupRequest(deviceName, input.copy(schoolUrl = schoolUrl))).execute().use { res ->
                val body = res.body?.string().orEmpty()
                if (!res.isSuccessful) return failure(res.code, body)
                val device = parseResponse(body)
                    ?: return SetupResult.Err("internal", "Réponse invalide : credential absent ou incohérent")
                SetupResult.Ok(device)
            }
        } catch (e: IOException) {
            SetupResult.Err("network", e.message ?: "Réseau indisponible")
        }
    }

    /**
     * Codes d'erreur du setup → phrase actionnable. Le serveur distingue
     * volontairement ces cas (400 qr_rejected / login_refused, 502
     * ent_unreachable, 429 rate_limited) : l'utilisateur doit pouvoir corriger
     * SA SAISIE, donc on ne dit jamais « recommence » quand « rescane » ou
     * « vérifie ton mot de passe » est la bonne réponse. Aucun 401 ici : ce
     * serait le garde-fou de session, pas une faute de saisie.
     */
    private fun failure(status: Int, body: String): SetupResult.Err {
        val code = runCatching { JSONObject(body).optJSONObject("error")?.optString("code", "") }.getOrNull().orEmpty()
        return SetupResult.Err(
            code.ifEmpty { "http_$status" },
            when (code) {
                "qr_rejected" -> "QR refusé par l'établissement : rescane le code affiché par son application."
                "login_refused" -> "Identifiants refusés par l'ENT : vérifie ton EduConnect et ton mot de passe."
                "ent_unreachable" -> "ENT injoignable depuis le serveur : réessaie dans un instant."
                "rate_limited" -> "Trop de tentatives : réessaie dans quelques minutes."
                "not_implemented" -> "Ce serveur n'a aucune session d'établissement branchée."
                "bad_request" -> "Saisie refusée par le serveur : vérifie l'adresse de l'établissement."
                else -> "Échec du setup (code ${code.ifEmpty { status }})".take(160)
            },
        )
    }
}

// Miroir de SETUP_* (shared/contracts/api.ts). Bornes appliquées côté serveur
// à chaque requête : l'app borne l'affichage et la saisie, pas la sécurité.
private const val SCHOOL_QR_FIELD_MAX_CHARS = 1024
private const val SCHOOL_URL_MAX_CHARS = 300

sealed interface HealthResult {
    data class Alive(val version: String) : HealthResult
    data class Unreachable(val message: String) : HealthResult
}

/**
 * Vérifie que l'adresse saisie répond. Appelé UNIQUEMENT sur appui explicite
 * de l'utilisateur à l'étape 1 (c'est sa demande, vers l'hôte qu'il vient de
 * saisir) : distinguer « mauvaise adresse » de « identifiants refusés » est
 * impossible autrement, et l'utilisateur ne peut pas deviner laquelle l'attend.
 *
 * Prend l'ADRESSE, pas un `ApiClient` : à l'étape 1, l'ApiClient du composable
 * est encore bound sur l'ancien serveur (il se reboucle à la recomposition
 * suivante), donc sonder « le client courant » testerait l'ancienne adresse —
 * le cas exactement quand l'utilisateur en a changé.
 */
fun probeHealthBlocking(baseUrl: String): HealthResult {
    val api = ApiClient(baseUrl)
    return try {
        api.client().newCall(api.buildGet(ServerConfig.HEALTH_PATH)).execute().use { res ->
            val body = res.body?.string().orEmpty()
            val o = runCatching { JSONObject(body) }.getOrNull()
            when {
                !res.isSuccessful ->
                    HealthResult.Unreachable("Le serveur a répondu ${res.code} sur /v1/health : ce n'est pas trèsslopnynotes.")
                o == null || o.optString("status", "") != "ok" ->
                    HealthResult.Unreachable("Réponse inattendue de /v1/health : ce serveur n'est pas trèsslopnynotes.")
                else -> HealthResult.Alive(o.optString("version", "?"))
            }
        }
    } catch (e: IOException) {
        HealthResult.Unreachable("Serveur injoignable (${e.message ?: "réseau indisponible"}). Vérifie l'adresse, le port et le réseau.")
    }
}

/** URL d'établissement bornée avant envoi (le serveur revalide de son côté). */
fun isBoundedSchoolUrl(value: String): Boolean {
    val text = value.trim()
    return text.isNotEmpty() && text.length <= SCHOOL_URL_MAX_CHARS
}

/**
 * Contenu scanné/collé → payload du QR de l'établissement.
 * Deux formes acceptées : le JSON que produit l'application de l'établissement
 * (`{"login":…,"jeton":…}`) et la forme compacte `login|jeton[|url]`, qui permet
 * de recopier le QR à la main quand l'appareil n'a pas de caméra utilisable.
 * Renvoie `null` plutôt que de lever : l'appelant affiche « QR illisible ».
 */
/**
 * Contenu scanné/collé → payload du QR de l'établissement.
 * Deux formes acceptées : le JSON que produit l'application de l'établissement
 * (`{"login":…,"jeton":…}`) et la forme compacte `login|jeton[|url]`, qui permet
 * de recopier le QR à la main quand l'appareil n'a pas de caméra utilisable.
 * Renvoie `null` plutôt que de lever : l'appelant affiche « QR illisible ».
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
            if (!bounded(login) || !bounded(jeton)) null else SchoolQr(login, jeton, url.ifEmpty { null })
        } catch (_: Exception) {
            null
        }
    }
    val parts = text.split('|')
    if (parts.size < 2) return null
    val login = parts[0].trim()
    val jeton = parts[1].trim()
    val url = parts.getOrNull(2)?.trim().orEmpty()
    if (!bounded(login) || !bounded(jeton)) return null
    return SchoolQr(login, jeton, url.ifEmpty { null })
}

private fun bounded(value: String): Boolean =
    value.isNotEmpty() && value.length <= SCHOOL_QR_FIELD_MAX_CHARS

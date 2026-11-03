package fr.veryslopnynotes.pronote

import java.util.zip.Deflater
import java.util.zip.Inflater

/**
 * Handshake (page HTML → attributs → `FonctionParametres`), POST chiffrés
 * (`AES`, `session`/`no`/`id`/`dataSec`) et/ou compressés (`deflateRaw`),
 * changement de clé après auth. Zéro dépendance (`java.util.zip`, `Json`).
 *
 * Tous les appels réseau sont BLOQUANTS : jamais sur le thread UI, le client
 * s'en charge.
 */

/** `Erreur.G` → message (inconnu = message brut `Titre`). */
val PRONOTE_ERROR_MESSAGES = mapOf(
    22 to "[ERROR 22] The object was from a previous session. Please read the \"Long Term Usage\" section in the README.",
    10 to "[ERROR 10] Session has expired and pronotets was not able to reinitialise the connection.",
    25 to "[ERROR 25] Exceeded max authorization requests. Please wait before retrying...",
)

/** HTTP 429 : refus de débit, même sens que `G=25`. */
private const val HTTP_TOO_MANY_REQUESTS = 429

/** `Retry-After` d'une réponse refusée (secondes ou date RFC 1123). */
private fun retryAfterOf(response: HttpResponse): Long? =
    response.headers.entries
        .firstOrNull { it.key.equals("Retry-After", ignoreCase = true) }
        ?.value?.firstOrNull()
        ?.let { RetryPolicy.parseRetryAfterMs(it) }

/**
 * Cause d'une page d'ouverture, TYPÉE : l'appelant branche dessus, jamais sur
 * le texte. La page de suspension est reconnue par une phrase (« adresse IP …
 * suspendue/bannie/bloquée »), pas par la seule présence des lettres « IP ».
 */
enum class HtmlPageCause { START, IP_SUSPENDED, UNEXPECTED }

private val SUSPENDED_PAGE = Regex(
    """(?is)\bIP\b.{0,120}?(?:suspend|banni|bloqu)|(?:suspend|banni|bloqu).{0,120}?\bIP\b""",
)

private val START_PAGE = Regex("""Start ?\(\{([^}]*)\}\)""")

internal fun htmlPageCause(html: String): HtmlPageCause = when {
    SUSPENDED_PAGE.containsMatchIn(html) -> HtmlPageCause.IP_SUSPENDED
    START_PAGE.containsMatchIn(html) -> HtmlPageCause.START
    else -> HtmlPageCause.UNEXPECTED
}

val PRONOTE_HEADERS = mapOf(
    "User-Agent" to "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:73.0) Gecko/20100101 Firefox/73.0",
)

val PRONOTE_HEADERS_MOBILE = mapOf("User-Agent" to "iPhone")

/** Espaces blancs JS (`trim`, `parseInt`) : ASCII + NBSP, pas tout Unicode. */
internal fun isJsSpace(c: Char): Boolean =
    c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\u000B' || c == '\u000C' || c == '\u00A0'

internal fun jsTrim(s: String): String = s.trim { isJsSpace(it) }

internal fun jsTrimStart(s: String): String = s.trimStart { isJsSpace(it) }

/**
 * Liste de valeurs d'octets séparées par des virgules : `parseInt(s, 10)` avec
 * `NaN` → 0, puis `& 0xFF` comme `Buffer.from`.
 */
fun enBytes(str: String): ByteArray {
    // `"".split(",")` = `[""]` → `[0]`, comme `Buffer.from([NaN])` côté TS.
    return str.split(",").map { part ->
        var s = jsTrimStart(part)
        var sign = 1
        if (s.startsWith("+") || s.startsWith("-")) {
            if (s.startsWith("-")) sign = -1
            s = s.drop(1)
        }
        var value = 0
        var digits = 0
        for (c in s) {
            if (c !in '0'..'9') break
            value = value * 10 + (c - '0')
            digits++
        }
        if (digits == 0) 0 else ((sign * value) and 0xFF).toByte()
    }.toByteArray()
}

/**
 * Aplatit `listeOnglets` en ids d'onglets : nombre → `[n]`, tableau/objet →
 * récursion, le reste écarté.
 */
fun prepareOnglets(value: JVal?): List<Double> {
    if (value == null) return emptyList()
    return when (value) {
        is JVal.Num -> listOf(value.value)
        is JVal.Arr -> value.items.flatMap { prepareOnglets(it) }
        is JVal.Obj -> value.fields.values.flatMap { prepareOnglets(it) }
        else -> emptyList()
    }
}

/** Changement de déchiffrement : IV et/ou clé appliqués BRUTS après le POST. */
data class DecryptionChange(val iv: ByteArray? = null, val key: ByteArray? = null)

internal fun parseIntJs(s: String): Double {
    var t = jsTrimStart(s)
    var sign = 1.0
    if (t.startsWith("+") || t.startsWith("-")) {
        if (t.startsWith("-")) sign = -1.0
        t = t.drop(1)
    }
    var value = 0.0
    var digits = 0
    for (c in t) {
        if (c !in '0'..'9') break
        value = value * 10 + (c - '0')
        digits++
    }
    return if (digits == 0) Double.NaN else sign * value
}

/** `attributes[k]` ou `"undefined"` (comme `${undefined}` en TS). */
private fun attrJs(attributes: Map<String, String>, key: String): String = attributes[key] ?: "undefined"

fun deflateRaw(data: ByteArray, level: Int = 6): ByteArray {
    val deflater = Deflater(level, true)
    deflater.setInput(data)
    deflater.finish()
    val out = java.io.ByteArrayOutputStream(data.size)
    val buf = ByteArray(8192)
    while (!deflater.finished()) {
        out.write(buf, 0, deflater.deflate(buf))
    }
    deflater.end()
    return out.toByteArray()
}

fun inflateRaw(data: ByteArray): ByteArray {
    val inflater = Inflater(true)
    inflater.setInput(data)
    val out = java.io.ByteArrayOutputStream(minOf(data.size * 2, MAX_RESPONSE_BYTES))
    val buf = ByteArray(8192)
    try {
        while (!inflater.finished()) {
            val n = inflater.inflate(buf)
            if (n == 0) {
                // Entrée épuisée ou flux tronqué : on rend ce qui est là.
                break
            }
            // Plafond AVANT l'écriture : 10 Mo de ciphertext peuvent gonfler à
            // plusieurs Go, et un OutOfMemoryError ne se rattrape pas ici.
            if (out.size() + n > MAX_RESPONSE_BYTES) {
                throw java.io.IOException("reponse compressee hors borne")
            }
            out.write(buf, 0, n)
        }
    } finally {
        inflater.end()
    }
    return out.toByteArray()
}

/** Octets bruts en attente d'inflation (réponse chiffrée + compressée). */
private class RawBytes(val bytes: ByteArray) : JVal

data class InitialResponse(val attributes: Map<String, String>, val response: JVal)

class Communication(site: String, cookieJar: CookieJar? = null, mobile: Boolean = false) {
    val rootSite: String
    val htmlPage: String
    val session: HttpSession
    val encryption = Encryption()
    var attributes: Map<String, String> = emptyMap()
    var requestNumber = 1
    val cookieJar: CookieJar? = cookieJar
    var lastPing: Long = 0
    var authorizedOnglets: List<Double> = emptyList()
    var compressRequests = false
    var encryptRequests = false

    init {
        // L'AUTORITÉ d'abord, puis le dernier segment.
        val (root, page) = getRootAddress(site)
        rootSite = root
        htmlPage = page
        session = HttpSession(if (mobile) PRONOTE_HEADERS_MOBILE else PRONOTE_HEADERS, cookieJar ?: CookieJar())
    }

    companion object {
        /**
         * L'AUTORITÉ (`scheme://host[:port]`) D'ABORD, puis le dernier segment
         * du chemin (la requête et le fragment restent avec ce segment).
         *
         * Couper au dernier `/` sans regarder l'autorité cassait le schéma d'un
         * site sans chemin (`https://host` → `https:/`), et le POST partait sur
         * un autre hôte.
         */
        fun getRootAddress(addr: String): Pair<String, String> {
            val scheme = addr.indexOf("://")
            val authorityStart = if (scheme >= 0) scheme + 3 else 0
            // L'AUTORITÉ s'arrête au premier `/`, `?` ou `#` après le schéma.
            val authority = addr.substring(authorityStart)
            val authorityLen = authority.indexOfFirst { it == '/' || it == '?' || it == '#' }
                .let { if (it < 0) authority.length else it }
            val authorityEnd = authorityStart + authorityLen
            // Le CHEMIN s'arrête à la requête ou au fragment.
            val afterAuthority = addr.substring(authorityEnd)
            val queryAt = afterAuthority.indexOfFirst { it == '?' || it == '#' }
            val pathEnd = if (queryAt < 0) addr.length else authorityEnd + queryAt
            val path = addr.substring(authorityEnd, pathEnd)
            val lastSlash = path.lastIndexOf('/')
            return if (lastSlash < 0) {
                // Sans chemin : racine = autorité, page vide.
                Pair(addr.substring(0, authorityEnd), addr.substring(authorityEnd))
            } else {
                val cut = authorityEnd + lastSlash
                Pair(addr.substring(0, cut), addr.substring(cut + 1))
            }
        }
    }

    /**
     * Envoie l'IV d'AES : tout ce qui suit est chiffré. 3 essais sur la page
     * HTML (seuls les échecs de `parseHtml` en consomment un).
     */
    fun initialise(clientIdentifier: String?): InitialResponse {
        var parsed: Map<String, String>? = null
        for (attempt in 0 until 3) {
            val res = session.get("$rootSite/$htmlPage")
            // 429 sur la page : inutile de réessayer, le serveur compte déjà
            // les requêtes.
            if (res.status == HTTP_TOO_MANY_REQUESTS) {
                throw RateLimitedError(
                    "Too many requests (http status: $HTTP_TOO_MANY_REQUESTS)",
                    pronoteErrorCode = null,
                    httpStatus = HTTP_TOO_MANY_REQUESTS,
                    retryAfterMs = retryAfterMs(res.headers),
                )
            }
            try {
                parsed = parseHtml(res.text)
                break
            } catch (_: Exception) {
                continue
            }
        }
        val attrs = parsed ?: throw PronoteAPIError("Unable to connect to pronote, please try again later")
        attributes = attrs
        // `http` non vide = RSA ; absent OU vide = IV en clair.
        val uuidBuf = if (!attrs["http"].isNullOrEmpty()) encryption.rsaEncrypt(encryption.aesIvTemp) else encryption.aesIvTemp
        val uuid = uuidBuf.toBase64()
        val jsonPost = JVal.Obj(
            linkedMapOf(
                "Uuid" to JVal.Str(uuid),
                "identifiantNav" to (clientIdentifier?.let { JVal.Str(it) } ?: JVal.Null),
            ),
        )
        encryptRequests = !attrs["CrA"].isNullOrEmpty()
        compressRequests = !attrs["CoA"].isNullOrEmpty()
        val initialResponse = post("FonctionParametres", mapOf("data" to jsonPost), DecryptionChange(iv = md5(encryption.aesIvTemp)))
        return InitialResponse(attrs, initialResponse)
    }

    /**
     * Enveloppe `{session, no, id, dataSec}` : compression (hex MAJUSCULE) puis
     * chiffrement (sauf `no`, minuscule comme en TS), compteur `+2`. Réponse :
     * erreur `Erreur` typée, déchiffrement, inflation si compressé.
     */
    // ponytail: un seul post a la fois, compteur/AES/cookies non thread-safe.
    @Synchronized
    fun post(functionName: String, data: Map<String, JVal>, decryptionChange: DecryptionChange? = null): JVal {
        val signature = data["Signature"] as? JVal.Obj
        if (signature != null) {
            val onglet = (signature.fields["onglet"] as? JVal.Num)?.value ?: -1.0
            if (!authorizedOnglets.contains(onglet)) {
                throw PronoteAPIError("Action not permitted. (onglet is not normally accessible)")
            }
        }
        var postData: Any = JVal.Obj(LinkedHashMap(data))
        if (compressRequests) {
            val hex = Json.stringify(postData as JVal).toByteArray(Charsets.UTF_8).toHexLower()
            postData = deflateRaw(hex.toByteArray(Charsets.UTF_8), 6).toHexLower().uppercase()
        }
        if (encryptRequests) {
            postData = if (postData is String) {
                encryption.aesEncrypt(postData.hexToBytes()).toHexLower().uppercase()
            } else {
                encryption.aesEncrypt(Json.stringify(postData as JVal).toByteArray(Charsets.UTF_8)).toHexLower().uppercase()
            }
        }
        val rNumber = encryption.aesEncrypt(requestNumber.toString().toByteArray(Charsets.UTF_8)).toHexLower()
        val envelope = LinkedHashMap<String, JVal>()
        envelope["session"] = JVal.Num(parseIntJs(attributes["h"] ?: ""))
        envelope["no"] = JVal.Str(rNumber)
        envelope["id"] = JVal.Str(functionName)
        envelope["dataSec"] = when (postData) {
            is String -> JVal.Str(postData)
            is JVal -> postData
            else -> throw IllegalStateException("dataSec inattendu")
        }
        val pSite = "$rootSite/appelfonction/${attrJs(attributes, "a")}/${attrJs(attributes, "h")}/$rNumber"
        val response = session.post(pSite, RequestOpts(json = JVal.Obj(envelope)))
        requestNumber += 2
        // La réponse n'est PAS gardée : texte + octets (jusqu'à 10 Mio) y
        // survivaient à chaque requête alors que personne ne les relisait.
        if (!response.ok) {
            // Le STATUT porte l'information (401 = session morte) : CHAMP de
            // l'erreur, jamais un mot du message.
            if (response.status == HTTP_TOO_MANY_REQUESTS) {
                throw RateLimitedError(
                    "Too many requests (http status: $HTTP_TOO_MANY_REQUESTS)",
                    pronoteErrorCode = null,
                    httpStatus = HTTP_TOO_MANY_REQUESTS,
                    retryAfterMs = retryAfterMs(response.headers),
                )
            }
            throw PronoteAPIError(
                "Bad request (http status: ${response.status})",
                httpStatus = response.status,
                retryAfterMs = retryAfterOf(response),
            )
        }
        // ponytail: ping arme seulement sur succes, sinon session morte semble vivante.
        lastPing = System.currentTimeMillis() / 1000
        // JSON invalide : `JsonError` BRUT, comme `SyntaxError` côté TS.
        val responseData = Json.parse(response.text) as? JVal.Obj
            ?: throw PronoteAPIError("Bad request (http status: ${response.status})")
        val erreur = responseData.fields["Erreur"] as? JVal.Obj
        if (erreur != null) {
            val g = (erreur.fields["G"] as? JVal.Num)?.value
            val gInt = if (g != null && g == kotlin.math.floor(g) && g < Int.MAX_VALUE) g.toInt() else null
            if (gInt == 22) throw ExpiredObject(PRONOTE_ERROR_MESSAGES.getValue(22))
            // `G=25` n'est pas une session morte : TYPE distinct pour que le
            // client ne rafraîchisse pas (un login de plus = plus de limitation).
            if (gInt == 25) throw RateLimitedError(PRONOTE_ERROR_MESSAGES.getValue(25), pronoteErrorCode = 25)
            val titre = (erreur.fields["Titre"] as? JVal.Str)?.value
            // `G`/`Titre` absents : `"undefined"`, comme `${undefined}` en TS.
            val gStr = if (g == null) "undefined" else jsNumber(g)
            val titreStr = titre ?: "undefined"
            throw PronoteAPIError(
                PRONOTE_ERROR_MESSAGES[gInt] ?: "Unknown error from pronote: $gStr | $titreStr",
                gInt,
                titre,
            )
        }
        if (decryptionChange != null) {
            if (decryptionChange.iv != null) encryption.aesIv = decryptionChange.iv
            if (decryptionChange.key != null) encryption.aesKey = decryptionChange.key
        }
        if (encryptRequests) {
            val dataSec = responseData.fields["dataSec"] as? JVal.Str
                ?: throw IllegalArgumentException("dataSec chiffré absent")
            val decrypted = encryption.aesDecrypt(dataSec.value.hexToBytes())
            responseData.fields["dataSec"] =
                if (compressRequests) RawBytes(decrypted) else Json.parse(decrypted.toString(Charsets.UTF_8))
        }
        if (compressRequests) {
            // `try` large (bare `catch` en TS) : inflation ET lecture JSON
            // corrompues valent le même `JSONDecodeError`.
            try {
                val d = responseData.fields["dataSec"]
                val raw: ByteArray = when (d) {
                    is JVal.Str -> d.value.hexToBytes()
                    is RawBytes -> d.bytes
                    else -> throw PronoteAPIError("JSONDecodeError while requesting from pronote.")
                }
                responseData.fields["dataSec"] = Json.parse(inflateRaw(raw).toString(Charsets.UTF_8))
            } catch (_: Exception) {
                throw PronoteAPIError("JSONDecodeError while requesting from pronote.")
            }
        }
        return responseData
    }

    @Synchronized
    fun afterAuth(data: JVal, authKey: ByteArray) {
        encryption.aesKey = authKey
        val dataSec = ((data as JVal.Obj).fields["dataSec"] as JVal.Obj).fields["data"] as JVal.Obj
        val cle = dataSec.fields["cle"] as JVal.Str
        val work = encryption.aesDecrypt(cle.value.hexToBytes())
        encryption.aesKey = md5(enBytes(work.toString(Charsets.UTF_8)))
    }

    /**
     * Attributs de session lus dans la page HTML (`Start({…})`, regex et non
     * parser). Cause TYPÉE : page de suspension réseau, ou page inattendue ;
     * sans `h`, erreur interne que `initialise` réessaie.
     */
    fun parseHtml(html: String): Map<String, String> {
        when (htmlPageCause(html)) {
            HtmlPageCause.IP_SUSPENDED -> throw IpSuspendedError()
            HtmlPageCause.UNEXPECTED -> throw UnexpectedPageError(
                "Page html is different than expected. Be sure that pronote_url is the direct url to your pronote page.",
            )
            HtmlPageCause.START -> Unit
        }
        val match = START_PAGE.find(html)
            ?: throw UnexpectedPageError(
                "Page html is different than expected. Be sure that pronote_url is the direct url to your pronote page.",
            )
        val attributes = LinkedHashMap<String, String>()
        for (attr in match.groupValues[1].split(",")) {
            val idx = attr.indexOf(':')
            val key = (if (idx >= 0) attr.substring(0, idx) else attr.dropLast(1)).let { jsTrim(it) }.stripQuotes()
            val value = (if (idx >= 0) attr.substring(idx + 1) else attr).let { jsTrim(it) }.stripQuotes()
            attributes[key] = value
        }
        if (!attributes.containsKey("h")) {
            throw IllegalStateException("internal exception to retry -> cannot parse html")
        }
        return attributes
    }

    private fun String.stripQuotes(): String {
        var r = this
        if (r.startsWith("'") || r.startsWith("\"")) r = r.drop(1)
        if (r.endsWith("'") || r.endsWith("\"")) r = r.dropLast(1)
        return r
    }
}

/**
 * Ping quand ~110 s d'inactivité ; le `post("Navigation", …)` vient du client,
 * ici seulement `shouldPing`/`pingRequest` (thread démon).
 *
 * `tickMs` est un paramètre pour que le harnais de parité pilote le VRAI code
 * avec un tick réel ; 1 000 ms reste la valeur de production.
 */
class KeepAlive(
    private val shouldPing: () -> Boolean,
    private val pingRequest: () -> Unit,
    private val tickMs: Long = 1000L,
) {
    @Volatile
    private var flag = false
    private var thread: Thread? = null

    /**
     * Ping si dû : lève en cas d'échec réseau/session, l'appelant décide du
     * repli. Le thread de garde, lui, ne lève jamais (voir `start`).
     */
    fun pingIfDue() {
        if (shouldPing()) pingRequest()
    }

    /**
     * Aller-retour FORCÉ, sans seuil : `pingIfDue` ne part jamais après une
     * lecture (le POST vient de rafraîchir `lastPing`), donc une relecture
     * manuelle ne vérifierait RIEN. Ici la session morte remonte son erreur.
     */
    fun ping() {
        pingRequest()
    }

    fun start() {
        flag = true
        val t = Thread({
            while (true) {
                try {
                    Thread.sleep(tickMs)
                } catch (_: InterruptedException) {
                    return@Thread
                }
                if (!flag) return@Thread
                if (shouldPing()) {
                    try {
                        pingRequest()
                    } catch (_: Exception) {
                        // Un ping raté n'arrête pas la garde.
                    }
                }
            }
        }, "pronote-keepalive")
        t.isDaemon = true
        t.start()
        thread = t
    }

    fun stop() {
        flag = false
        thread?.interrupt()
    }
}

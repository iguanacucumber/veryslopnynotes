package fr.veryslopnynotes.pronote

import java.util.zip.Deflater
import java.util.zip.Inflater

/**
 * Dialogue avec les serveurs PRONOTE (#200, port de `pronotets` `communication.js`).
 *
 * Handshake (page HTML → attributs → `FonctionParametres`), POST chiffrés
 * (`AES`, `session`/`no`/`id`/`dataSec`) et/ou compressés (`deflateRaw`),
 * changement de clé après auth. Zéro dépendance : `java.util.zip` pour le
 * `nowrap`, `Json` maison pour les enveloppes.
 *
 * Tous les appels réseau sont BLOQUANTS (pas de coroutines sans dépendance) :
 * ne jamais appeler sur le thread UI — le client (#201) s'en charge.
 */

/** `Erreur.G` → message, comme côté TS (inconnu = message brut `Titre`). */
val PRONOTE_ERROR_MESSAGES = mapOf(
    22 to "[ERROR 22] The object was from a previous session. Please read the \"Long Term Usage\" section in the README.",
    10 to "[ERROR 10] Session has expired and pronotets was not able to reinitialise the connection.",
    25 to "[ERROR 25] Exceeded max authorization requests. Please wait before retrying...",
)

val PRONOTE_HEADERS = mapOf(
    "User-Agent" to "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:73.0) Gecko/20100101 Firefox/73.0",
)

val PRONOTE_HEADERS_MOBILE = mapOf("User-Agent" to "iPhone")

/**
 * Espaces blancs JS (`String.trim`, préfixe `parseInt`) : ASCII + NBSP, pas tout
 * Unicode — le protocole n'émet que de l'ASCII, mais autant être exact.
 */
internal fun isJsSpace(c: Char): Boolean =
    c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\u000B' || c == '\u000C' || c == '\u00A0'

internal fun jsTrim(s: String): String = s.trim { isJsSpace(it) }

internal fun jsTrimStart(s: String): String = s.trimStart { isJsSpace(it) }

/**
 * Supprime l'entrelacement de caractères de PRONOTE sur certains champs
 * encodés (un caractère sur deux, en unités UTF-16 comme `text[i]` côté TS).
 */
fun enleverAlea(text: String): String {
    val out = StringBuilder(text.length / 2 + 1)
    var i = 0
    while (i < text.length) {
        out.append(text[i])
        i += 2
    }
    return out.toString()
}

/**
 * Recompose une liste de valeurs d'octets séparées par des virgules (telle que
 * produite par le JS de PRONOTE). `parseInt(s, 10)` : préfixe décimal signé
 * après espaces, `NaN` → 0 — puis `& 0xFF` comme `Buffer.from`.
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
 * Aplatit la structure `listeOnglets` imbriquée de PRONOTE en ids d'onglets.
 * Nombre → `[n]` ; tableau → récursion (objets → leurs valeurs) ; le reste
 * (chaîne, booléen, `null`) est écarté, comme côté TS.
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

/** `parseInt(s, 10)` : préfixe décimal signé, `NaN` si aucun chiffre. */
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

/** `attributes[k]` ou la chaîne `"undefined"` (comme `${undefined}` côté TS). */
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
    val out = java.io.ByteArrayOutputStream(data.size * 2)
    val buf = ByteArray(8192)
    while (!inflater.finished()) {
        val n = inflater.inflate(buf)
        if (n == 0) {
            if (inflater.needsInput()) break
        }
        out.write(buf, 0, n)
    }
    inflater.end()
    return out.toByteArray()
}

/** Octets bruts en attente d'inflation (réponse chiffrée + compressée). */
private class RawBytes(val bytes: ByteArray) : JVal

/** Enveloppe `FonctionParametres` : attributs lus + réponse initiale. */
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
    var lastResponse: HttpResponse? = null

    init {
        // `getRootAddress` : l'AUTORITÉ d'abord, puis le dernier segment.
        val (root, page) = getRootAddress(site)
        rootSite = root
        htmlPage = page
        session = HttpSession(if (mobile) PRONOTE_HEADERS_MOBILE else PRONOTE_HEADERS, cookieJar ?: CookieJar())
    }

    companion object {
        /**
         * Découpe l'adresse d'établissement : l'AUTORITÉ (`scheme://host[:port]`)
         * D'ABORD, puis le dernier segment du chemin (la requête et le fragment
         * restent avec ce segment).
         *
         * Couper au dernier `/` sans regarder l'AUTORITÉ coupait le schéma
         * lui-même : un site SANS chemin (`https://host`) donnait `https:/`,
         * et le POST partait alors sur `https://appelfonction/...` — un autre
         * hôte — donc l'établissement devenait INUTILISABLE (UnknownHost
         * Exception : toutes les requêtes échouaient, #429). La référence TS
         * coupe de la même façon (son `rootSite` vaut `https:/`) et vise, elle,
         * la page demandée : l'autorité entière.
         */
        fun getRootAddress(addr: String): Pair<String, String> {
            val scheme = addr.indexOf("://")
            val authorityStart = if (scheme >= 0) scheme + 3 else 0
            // L'AUTORITÉ s'arrête au premier `/`, `?` ou `#` après le schéma.
            val authority = addr.substring(authorityStart)
            val authorityLen = authority.indexOfFirst { it == '/' || it == '?' || it == '#' }
                .let { if (it < 0) authority.length else it }
            val authorityEnd = authorityStart + authorityLen
            // Le CHEMIN s'arrête à la requête (`?`) ou au fragment (`#`).
            val afterAuthority = addr.substring(authorityEnd)
            val queryAt = afterAuthority.indexOfFirst { it == '?' || it == '#' }
            val pathEnd = if (queryAt < 0) addr.length else authorityEnd + queryAt
            val path = addr.substring(authorityEnd, pathEnd)
            val lastSlash = path.lastIndexOf('/')
            return if (lastSlash < 0) {
                // Site SANS chemin : la racine est l'autorité, la page est vide.
                Pair(addr.substring(0, authorityEnd), addr.substring(authorityEnd))
            } else {
                val cut = authorityEnd + lastSlash
                Pair(addr.substring(0, cut), addr.substring(cut + 1))
            }
        }
    }

    /**
     * Monte le chiffrement et envoie l'IV d'AES à PRONOTE : tout ce qui suit
     * est chiffré. 3 essais sur la page HTML (une page inattendue = nouvel
     * essai, comme côté TS qui ne retient que les échecs de `parseHtml`).
     */
    fun initialise(clientIdentifier: String?): InitialResponse {
        var parsed: Map<String, String>? = null
        for (attempt in 0 until 3) {
            val res = session.get("$rootSite/$htmlPage")
            try {
                parsed = parseHtml(res.text)
                break
            } catch (_: Exception) {
                continue
            }
        }
        val attrs = parsed ?: throw PronoteAPIError("Unable to connect to pronote, please try again later")
        attributes = attrs
        // `attributes["http"]` non vide = RSA ; absent OU VIDE = IV en clair
        // (le TS teste la vérité de la chaîne, pas sa présence).
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
     * POST `appelfonction` : enveloppe `{session, no, id, dataSec}`, compression
     * (`hex` UTF-8 → `deflateRaw`, niveau 6, hex MAJUSCULE) puis chiffrement
     * (hex MAJUSCULE — sauf `no`, minuscule comme côté TS). `numero` chiffré
     * du compteur, compteur `+2`. Réponse : erreur `Erreur` typée, déchiffrement
     * (clé/IV bruts si `decryptionChange`), inflation si compressé.
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
        lastResponse = response
        if (!response.ok) {
            throw PronoteAPIError("Bad request (http status: ${response.status})")
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
            val titre = (erreur.fields["Titre"] as? JVal.Str)?.value
            // `G`/`Titre` absents : `"undefined"`, comme `${undefined}` côté TS.
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
            // `try` large comme côté TS (bare `catch`) : inflation ET lecture
            // JSON corrompues valent le même `JSONDecodeError`.
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

    /** Changement de clé après une authentification réussie. */
    @Synchronized
    fun afterAuth(data: JVal, authKey: ByteArray) {
        encryption.aesKey = authKey
        // (Le `if (!cookieJar)` du TS est un no-op commenté : rien à y porter.)
        val dataSec = ((data as JVal.Obj).fields["dataSec"] as JVal.Obj).fields["data"] as JVal.Obj
        val cle = dataSec.fields["cle"] as JVal.Str
        val work = encryption.aesDecrypt(cle.value.hexToBytes())
        encryption.aesKey = md5(enBytes(work.toString(Charsets.UTF_8)))
    }

    /**
     * Attributs de session lus dans la page HTML (`Start({…})`, une regex pas
     * de parser HTML, comme côté TS). `IP` présent n'importe où = banni.
     * Sans `h` : erreur interne brute (l'`initialise` réessaie, comme côté TS
     * où c'est une `Error` nue).
     */
    fun parseHtml(html: String): Map<String, String> {
        if (html.contains("IP")) {
            throw PronoteAPIError("Your IP address is suspended.")
        }
        val match = Regex("""Start ?\(\{([^}]*)\}\)""").find(html)
            ?: throw PronoteAPIError("Page html is different than expected. Be sure that pronote_url is the direct url to your pronote page.")
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
 * Maintient la session en vie : un ping quand ~110 s d'inactivité, comme
 * `_KeepAlive` (le `post("Navigation", …)` est fourni par le client #201 :
 * ici `shouldPing`/`pingRequest`, zéro dépendance, thread démon).
 *
 * [tickMs] est la PÉRIODE du fil de garde (1 000 ms en production). C'est un
 * paramètre, pas une constante : le harnais de parité (#202) pilote le VRAI
 * code et doit observer un tick RÉEL, or 1 s de attente réelle par test est
 * un luxe que la suite ne peut pas payer 30 fois. La valeur par défaut est
 * celle de production — un test la vérifie
 * (`tests/architecture/keepalive-ping.test.ts`) pour que personne ne la
 * change par accident.
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
     * Ping de session si dû (~110 s d'inactivité) : lève en cas d'échec
     * réseau/session (#205 : relecture manuelle locale, l'appelant décide du
     * repli). Le thread de garde, lui, ne lève jamais (voir `start`).
     */
    fun pingIfDue() {
        if (shouldPing()) pingRequest()
    }

    /**
     * Ping MANUEL : un aller-retour FORCÉ, sans seuil (#408).
     *
     * `pingIfDue` ne part JAMAIS après une lecture : le POST vient de
     * rafraîchir `lastPing`, donc le seuil de 110 s n'est pas atteint. Une
     * relecture manuelle ne vérifiait donc RIEN de la session — une session
     * morte passait pour vivante. Ici la requête part TOUJOURS : la session
     * morte remonte son erreur, et l'appelant peut la traduire (ré-appairage).
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
                        // Un ping raté n'arrête pas la garde (comme `setInterval`).
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

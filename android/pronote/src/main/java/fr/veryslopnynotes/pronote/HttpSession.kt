package fr.veryslopnynotes.pronote

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.zip.GZIPInputStream

/** Plafond d'une réponse (10 Mo), une fois décompressée comme avant (#474). */
private const val MAX_RESPONSE_BYTES = 10_485_760

/**
 * Session HTTP du protocole (#200, port de `pronotets` `http.js`).
 *
 * L'équivalent de `requests.Session` : jar à cookies persistant (RFC 6265,
 * sans `tough-cookie`) + redirects suivies à la main, car ni
 * `HttpURLConnection` ni `fetch` ne gardent les cookies seuls. Transport :
 * `HttpURLConnection` (plateforme, zéro dépendance).
 *
 * Fidélité assumée : pas de timeout (comme `fetch` côté TS — c'est le client
 * #201 qui bornera), redirects max 10 avec la même boucle (le `throw` final
 * est inatteignable des deux côtés : la boucle retourne toujours), passage
 * POST → GET sur 303 (et 301/302 émises pour un POST).
 */

/** Un cookie stocké : `name`/`domain`/`path` forment l'identité (jamais mutés). */
private data class StoredCookie(
    val name: String,
    var value: String,
    val domain: String,
    val hostOnly: Boolean,
    val path: String,
    var expiresAt: Long?,
    var secure: Boolean,
    val createdAt: Long,
)

class CookieJar {
    private val cookies = mutableListOf<StoredCookie>()
    private var clock: Long = 0

    private fun now(): Long = if (clock > 0) clock else System.currentTimeMillis()

    /** Horloge injectée (tests déterministes) ; `0` = heure réelle. */
    fun setNow(millis: Long) {
        clock = millis
    }

    /** `Cookie` à envoyer pour cette URL (`""` = rien à envoyer). */
    fun getCookieString(url: String): String {
        val u = URL(url)
        val host = u.host.lowercase(Locale.ROOT)
        val secure = u.protocol.equals("https", ignoreCase = true)
        val path = u.path.ifEmpty { "/" }
        val now = now()
        cookies.removeAll { val exp = it.expiresAt; exp != null && exp <= now }
        // RFC 6265 §5.4 : chemins longs d'abord, puis ancienneté.
        return cookies
            .filter { matches(it, host, path, secure) }
            .sortedWith(compareByDescending<StoredCookie> { it.path.length }.thenBy { it.createdAt })
            .joinToString("; ") { "${it.name}=${it.value}" }
    }

    private fun matches(c: StoredCookie, host: String, path: String, secure: Boolean): Boolean {
        if (c.secure && !secure) return false
        if (c.hostOnly) {
            if (host != c.domain) return false
        } else {
            if (host != c.domain && !host.endsWith(".${c.domain}")) return false
        }
        // RFC 6265 §5.1.4 : égal, ou préfixe terminé par `/`.
        if (path != c.path && !(path.startsWith(c.path) && (c.path.endsWith("/") || path.getOrNull(c.path.length) == '/'))) {
            return false
        }
        return true
    }

    /**
     * Enregistre un en-tête `Set-Cookie` (une seule valeur ; les doublons
     * empilés avec virgule sont re-découpés, `Expires` contenant une virgule).
     * En-tête malformé = ignoré en silence (comme `requests`).
     *
     * Frontière assumée : un `Domain=` IP-littéral accepté si l'hôte correspond
     * (`tough-cookie` le refuse comme « public suffix »). Aucun serveur réel
     * n'émet ça (cookies hôte-seul ou domaines publics) — la parité ne le couvre pas.
     */
    fun setCookie(headerValue: String, url: String) {
        val u = try {
            URL(url)
        } catch (_: Exception) {
            return
        }
        for (single in splitStacked(headerValue)) {
            storeOne(single, u)
        }
    }

    /** Re-découpe `a=b, c=d` sans couper la virgule de `Expires=Wed, 21…`. */
    private fun splitStacked(headerValue: String): List<String> {
        // Une virgule n'ouvre un nouveau cookie que si la suite est `nom=` —
        // la virgule d'`Expires` est suivie d'une date, jamais d'un `nom=`.
        val out = mutableListOf<String>()
        var current = StringBuilder()
        var i = 0
        while (i < headerValue.length) {
            val c = headerValue[i]
            if (c == ',' && NEW_COOKIE_START.containsMatchIn(headerValue.substring(i + 1))) {
                out.add(current.toString())
                current = StringBuilder()
                i++
                continue
            }
            current.append(c)
            i++
        }
        out.add(current.toString())
        return out
    }

    private val NEW_COOKIE_START = Regex("^\\s*[A-Za-z0-9_\\-]+\\s*=")

    private fun storeOne(headerValue: String, u: URL) {
        val pieces = headerValue.split(";")
        val first = pieces[0].trim()
        val eq = first.indexOf('=')
        if (eq <= 0) return
        val name = first.substring(0, eq).trim()
        if (name.isEmpty()) return
        var value = first.substring(eq + 1).trim()
        // Valeur entre guillemets : le `DQUOTE` d'enveloppe ne fait pas partie
        // de la valeur (RFC 6265 §5.2).
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1)
        }
        val host = u.host.lowercase(Locale.ROOT)
        var domain = host
        var hostOnly = true
        var path = defaultPath(u.path)
        var expiresAt: Long? = null
        var maxAge: Long? = null
        var secure = false
        for (raw in pieces.drop(1)) {
            val attr = raw.trim()
            val aEq = attr.indexOf('=')
            val aName = (if (aEq < 0) attr else attr.substring(0, aEq)).trim().lowercase(Locale.ROOT)
            val aValue = if (aEq < 0) "" else attr.substring(aEq + 1).trim()
            when (aName) {
                "domain" -> {
                    var d = aValue.lowercase(Locale.ROOT)
                    if (d.startsWith(".")) d = d.drop(1)
                    if (d.isEmpty()) return
                    // Le domaine du cookie doit dominer l'hôte (sinon : refusé).
                    if (host != d && !host.endsWith(".$d")) return
                    domain = d
                    hostOnly = false
                }
                "path" -> {
                    path = if (aValue.startsWith("/")) aValue else defaultPath(u.path)
                }
                "max-age" -> {
                    maxAge = aValue.toLongOrNull()
                }
                "expires" -> {
                    expiresAt = parseHttpDate(aValue)
                }
                "secure" -> secure = true
            }
        }
        val age = maxAge
        if (age != null) {
            expiresAt = if (age <= 0) 0L else now() + age * 1000L
        }
        val existing = cookies.indexOfFirst { it.name == name && it.domain == domain && it.path == path }
        val exp = expiresAt
        if (exp != null && exp <= now()) {
            if (existing >= 0) cookies.removeAt(existing)
            return
        }
        if (existing >= 0) {
            // RFC 6265 §5.3 étape 12 : même (nom, domaine, chemin) — la valeur
            // et l'expiration sont remplacées, l'ancienneté gardée.
            val c = cookies[existing]
            c.value = value
            c.expiresAt = expiresAt
            c.secure = secure
        } else {
            cookies.add(StoredCookie(name, value, domain, hostOnly, path, expiresAt, secure, now()))
        }
    }

    private fun defaultPath(requestPath: String): String {
        if (!requestPath.startsWith("/")) return "/"
        val last = requestPath.lastIndexOf('/')
        return if (last <= 0) "/" else requestPath.substring(0, last)
    }

    private fun parseHttpDate(value: String): Long? {
        val formats = listOf(
            "EEE, dd MMM yyyy HH:mm:ss z",
            "EEEE, dd-MMM-yy HH:mm:ss z",
            "EEE MMM d HH:mm:ss yyyy",
        )
        for (f in formats) {
            try {
                val sdf = SimpleDateFormat(f, Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("GMT")
                sdf.isLenient = false
                return sdf.parse(value)?.time
            } catch (_: Exception) {
                continue
            }
        }
        return null
    }
}

data class RequestOpts(
    val params: Map<String, String>? = null,
    val headers: Map<String, String>? = null,
    val json: JVal? = null,
    val data: Map<String, String?>? = null,
    val maxRedirects: Int = 10,
)

data class HttpResponse(
    val status: Int,
    val ok: Boolean,
    val url: String,
    val headers: Map<String, List<String>>,
    val text: String,
    val content: ByteArray,
) {
    fun json(): JVal = Json.parse(text)
}

class HttpSession(
    headers: Map<String, String> = emptyMap(),
    val jar: CookieJar = CookieJar(),
) {
    private val baseHeaders: Map<String, String> = HashMap(headers)

    fun buildUrl(url: String, params: Map<String, String>?): String {
        if (params.isNullOrEmpty()) return url
        val sb = StringBuilder(url)
        sb.append(if (url.contains("?")) "&" else "?")
        params.entries.forEachIndexed { i, (k, v) ->
            if (i > 0) sb.append('&')
            sb.append(urlEncode(k)).append('=').append(urlEncode(v))
        }
        return sb.toString()
    }

    /** `URLSearchParams.set` : UTF-8, espace → `+` (comme `URLEncoder`). */
    private fun urlEncode(s: String): String = URLEncoder.encode(s, "UTF-8")

    // ponytail: plafond 10 Mo par chunks, evite OOM sur grosse reponse.
    private fun cappedBytes(stream: java.io.InputStream, max: Int): ByteArray {
        stream.use { s ->
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(8192)
            var total = 0
            while (true) {
                val n = s.read(buf)
                if (n < 0) break
                total += n
                if (total > max) throw java.io.IOException("Reponse trop volumineuse")
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }
    }

    /**
     * `Location` d'une redirection → URL absolue.
     *
     * Une `Location` ILLISIBLE (protocole inconnu, espace dans l'hôte,
     * autorité cassée) est une PANNE RÉSEAU : elle devient une `IOException`
     * — donc « réseau » pour l'app — et non une `MalformedURLException`
     * brute qui remontait au caller sans mapper (#429).
     *
     * L'hôte est validé ICI, pas par le constructeur `URL` : celui-ci ne
     * valide pas l'hôte de la même façon selon la JVM. Sur JDK 25,
     * `URL("http://ho st/x")` est refusée à la construction ; sur JDK 17 elle
     * est ACCEPTÉE, et l'échec arrive plus tard, à la résolution DNS —
     * `UnknownHostException` BRUTE, non mappée, et un comportement différent
     * selon la JVM (#497). La panne est donc toujours la même.
     */
    private fun resolveRedirect(currentUrl: String, location: String): String {
        val target = try {
            URL(URL(currentUrl), location).toString()
        } catch (e: Exception) {
            throw java.io.IOException("Redirection invalide", e)
        }
        val host = try {
            URL(target).host
        } catch (_: Exception) {
            ""
        }
        if (host.isEmpty() || host.any { it.isWhitespace() }) {
            throw java.io.IOException("Redirection invalide")
        }
        return target
    }

    /**
     * Décompression d'une réponse `gzip` (#474).
     *
     * `HttpURLConnection` ne décompresse QUE ce qu'il a lui-même demandé : dès
     * qu'on pose `Accept-Encoding`, la decompression nous revient. Donc
     * `Content-Encoding: gzip` présent = corps ENCORE compressé.
     *
     * ÉCHEC = octets BRUTS conservés : on ne perd JAMAIS la réponse (un
     * serveur qui annonce `gzip` et envoie autre chose ne doit pas faire
     * échouer la lecture). Le PLAFOND reste le même une fois décompressé
     * (une bombe gzip ne doit pas non plus faire exploser la mémoire).
     */
    private fun gunzip(raw: ByteArray): ByteArray {
        if (raw.isEmpty()) return raw
        return try {
            GZIPInputStream(java.io.ByteArrayInputStream(raw)).use { cappedBytes(it, MAX_RESPONSE_BYTES) }
        } catch (_: Exception) {
            raw
        }
    }

    fun request(method: String, url: String, opts: RequestOpts = RequestOpts()): HttpResponse {
        val maxRedirects = opts.maxRedirects
        var currentMethod = method
        var currentUrl = buildUrl(url, opts.params)
        var body: ByteArray? = null
        val headers = HashMap(baseHeaders)
        opts.headers?.let { headers.putAll(it) }
        // #474 : la session DEMANDE la compression. Sans cet en-tête, les
        // réponses volumineuses de l'établissement (EDT, notes, cahier de
        // texte) remontent en clair. On ne l'écrase pas si l'appelant en a
        // déjà posé un (il sait ce qu'il demande).
        if (headers.keys.none { it.equals("Accept-Encoding", ignoreCase = true) }) {
            headers["Accept-Encoding"] = "gzip"
        }
        if (opts.json !== null) {
            body = Json.stringify(opts.json).toByteArray(Charsets.UTF_8)
            headers["Content-Type"] = "application/json"
        } else if (opts.data !== null) {
            val usp = opts.data.entries.joinToString("&") { (k, v) -> "${urlEncode(k)}=${urlEncode(v ?: "")}" }
            body = usp.toByteArray(Charsets.UTF_8)
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        }
        for (redirect in 0..maxRedirects) {
            val conn = URL(currentUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.instanceFollowRedirects = false
            conn.requestMethod = currentMethod
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            val cookieHeader = jar.getCookieString(currentUrl)
            if (cookieHeader.isNotEmpty()) conn.setRequestProperty("Cookie", cookieHeader)
            try {
                if (body != null && currentMethod != "GET" && currentMethod != "HEAD") {
                    conn.doOutput = true
                    conn.outputStream.use { it.write(body) }
                }
                val status = conn.responseCode
                // En-têtes reçus : clé insensible à la casse (comme `Headers`).
                val received = LinkedHashMap<String, List<String>>()
                for ((k, values) in conn.headerFields) {
                    if (k == null || values == null) continue
                    received.merge(k, values) { a, b -> a + b }
                }
                fun header(name: String): List<String> =
                    received.entries.filter { it.key.equals(name, ignoreCase = true) }.flatMap { it.value }
                for (sc in header("set-cookie")) {
                    try {
                        jar.setCookie(sc, currentUrl)
                    } catch (_: Exception) {
                        // Cookie malformé : ignoré (comme `requests`).
                    }
                }
                val location = header("location").firstOrNull()
                val isRedirect = status in 300..399 && location != null
                if (isRedirect && redirect < maxRedirects) {
                    // `Location` ILLISIBLE : erreur réseau mappée, PAS une
                    // `MalformedURLException` brute (#429).
                    val nextUrl = resolveRedirect(currentUrl, location)
                    // ponytail: meme-hote garde corps (parite 307), hote change = drop corps + content-type.
                    try {
                        if (URL(nextUrl).host.lowercase(java.util.Locale.ROOT) != URL(currentUrl).host.lowercase(java.util.Locale.ROOT)) {
                            body = null
                            headers.remove("Content-Type")
                        }
                    } catch (_: Exception) {
                        body = null
                        headers.remove("Content-Type")
                    }
                    currentUrl = nextUrl
                    // 303 (et 301/302 émises pour un POST) => GET, comme navigateurs.
                    if (status == 303 || ((status == 301 || status == 302) && currentMethod == "POST")) {
                        currentMethod = "GET"
                        body = null
                    }
                    conn.disconnect()
                    continue
                }
                // Chemin de SUCCÈS : pas de `disconnect()` — le corps est lu jusqu'au
                // bout puis fermé (`cappedBytes`), donc le socket retourne au cache
                // keep-alive de `HttpURLConnection` et le POST suivant du refresh
                // réutilise la MÊME connexion au lieu de repayer un handshake TCP+TLS
                // (#309). Fermer ici à chaque réponse vidait ce cache.
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                val raw: ByteArray = if (stream == null) ByteArray(0) else cappedBytes(stream, MAX_RESPONSE_BYTES)
                // #474 : l'établissement a compressé la réponse — on la rend
                // lisible. Un `Content-Encoding` absent = corps déjà en clair
                // (la décompression est faite PAR LE PLATEFORME quand celui-ci
                // a posé l'en-tête ; le nôtre l'a posé, donc c'est à nous).
                val gzipped = header("content-encoding").any { it.trim().equals("gzip", ignoreCase = true) }
                val bytes: ByteArray = if (gzipped) gunzip(raw) else raw
                return HttpResponse(
                    status = status,
                    ok = status in 200..299,
                    url = currentUrl,
                    headers = received,
                    text = bytes.toString(Charsets.UTF_8),
                    content = bytes,
                )
            } catch (e: Exception) {
                // TOUTE sortie en erreur de l'itération referme le socket : une
                // `Location` illisible, un corps coupé (plafond 10 Mo, socket
                // mort) ou une écriture refusée ne doivent JAMAIS laisser la
                // connexion ouverte — le pool de sockets se remplissait à chaque
                // redirection malformée (#429).
                try { conn.disconnect() } catch (_: Exception) {}
                throw e
            }
        }
        // Inatteignable (la boucle retourne toujours), comme côté TS.
        throw IllegalStateException("Too many redirects")
    }

    fun get(url: String, opts: RequestOpts = RequestOpts()): HttpResponse = request("GET", url, opts)

    fun post(url: String, opts: RequestOpts = RequestOpts()): HttpResponse = request("POST", url, opts)
}

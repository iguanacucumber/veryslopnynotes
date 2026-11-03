package fr.veryslopnynotes.pronote

import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.zip.GZIPInputStream

/** Plafond d'une réponse (10 Mio), en OCTETS UTF-8 une fois décompressée. */
internal const val MAX_RESPONSE_BYTES = 10_485_760

/** Budget TOTAL d'une requête scolaire : connect, redirects, en-têtes et corps. */
internal const val DEFAULT_REQUEST_DEADLINE_MS = 15_000L

private const val CONNECT_TIMEOUT_MS = 15_000L
/** Tranche de lecture : permet de voir un abandon SANS attendre l'échéance totale. */
private const val READ_SLICE_MS = 2_000L

/**
 * Copie [input] vers [output] en refusant au-delà de [maxBytes] OCTETS lus.
 * Le dépassement est une `IOException` : aucune réponse partielle n'est gardée
 * par l'appelant (fichier temporaire supprimé, tampon jeté).
 *
 * [deadline] et [cancellation] sont vérifiées À CHAQUE LECTURE : un serveur qui
 * s'égoutte ne repousse jamais l'échéance.
 */
internal fun copyBounded(
    input: java.io.InputStream,
    output: java.io.OutputStream,
    maxBytes: Int,
    deadline: RequestDeadline? = null,
    cancellation: RequestCancellation? = null,
): Long {
    val buf = ByteArray(8192)
    var total = 0L
    while (true) {
        deadline?.check()
        cancellation?.throwIfCancelled()
        val n = try {
            input.read(buf)
        } catch (_: SocketTimeoutException) {
            // `readTimeout` n'est qu'une TRANCHE : l'échéance totale décide.
            // Une tranche expirée sans abandon ni échéance se retente.
            deadline?.check()
            cancellation?.throwIfCancelled()
            continue
        }
        if (n < 0) break
        deadline?.check()
        cancellation?.throwIfCancelled()
        total += n
        if (total > maxBytes) throw java.io.IOException("Reponse trop volumineuse")
        output.write(buf, 0, n)
    }
    return total
}

/**
 * Jar à cookies persistant (RFC 6265) + redirects suivies à la main : ni
 * `HttpURLConnection` ni `fetch` ne gardent les cookies seuls. Transport :
 * `HttpURLConnection`, zéro dépendance.
 *
 * Pas de timeout de lecture global ici : [RequestOpts.deadlineMs] borne la
 * requête ENTIÈRE (redirects, en-têtes et corps). Chaque lecture utilise une
 * tranche courte pour voir un abandon, et l'échéance totale est vérifiée à
 * chaque tour. Redirects max 10, POST → GET sur 303 (et 301/302 pour un POST).
 */

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

    /** Horloge injectée (tests) ; `0` = heure réelle. */
    fun setNow(millis: Long) {
        clock = millis
    }

    /** `""` = rien à envoyer. */
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
 * En-tête malformé = ignoré en silence (comme `requests`).
 *
 * Frontière assumée : `Domain=` IP-littéral accepté si l'hôte correspond, ce
 * que `tough-cookie` refuse ; aucun serveur réel n'émet ça.
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

    /** Re-découpe `a=b, c=d` sans couper la virgule de `Expires`. */
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
        // Valeur entre guillemets : le `DQUOTE` d'enveloppe est retiré (RFC 6265 §5.2).
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
            // Même (nom, domaine, chemin) : valeur et expiration remplacées,
            // ancienneté gardée (RFC 6265 §5.3).
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
    /** Budget total de l'opération ; `null` = [DEFAULT_REQUEST_DEADLINE_MS]. */
    val deadlineMs: Long? = null,
    /** Jeton de l'appelant ; `null` = celui posé par [RequestScope]. */
    val cancellation: RequestCancellation? = null,
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

    /** Comme `URLSearchParams` : UTF-8, espace → `+` (`URLEncoder`). */
    private fun urlEncode(s: String): String = URLEncoder.encode(s, "UTF-8")

    // ponytail: plafond 10 Mio par chunks, evite OOM sur grosse reponse.
    private fun cappedBytes(
        stream: java.io.InputStream,
        max: Int,
        deadline: RequestDeadline? = null,
        cancellation: RequestCancellation? = null,
    ): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        stream.use { copyBounded(it, out, max, deadline, cancellation) }
        return out.toByteArray()
    }

/**
 * `Location` illisible (protocole inconnu, espace dans l'hôte) = PANNE RÉSEAU :
 * une `IOException`, jamais une `MalformedURLException` brute.
 *
 * L'hôte est validé ICI : le constructeur `URL` le refuse sur JDK 25 mais
 * l'accepte sur JDK 17, où l'échec arrive en DNS (`UnknownHostException` brute).
 * La panne doit être la même selon la JVM.
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
 * `HttpURLConnection` ne décompresse QUE ce qu'il a demandé : dès qu'on pose
 * `Accept-Encoding`, c'est à nous. ÉCHEC = octets BRUTS conservés, on ne perd
 * JAMAIS la réponse. Le plafond s'applique aussi après décompression.
 */
    private fun gunzip(raw: ByteArray): ByteArray {
        if (raw.isEmpty()) return raw
        return try {
            GZIPInputStream(java.io.ByteArrayInputStream(raw)).use { cappedBytes(it, MAX_RESPONSE_BYTES) }
        } catch (_: Exception) {
            raw
        }
    }

    fun request(method: String, url: String, opts: RequestOpts = RequestOpts()): HttpResponse =
        request(method, url, opts, null, MAX_RESPONSE_BYTES)

    /**
     * Télécharge un corps 2xx vers [dest] en flux, sans jamais le matérialiser
     * en mémoire. Au-delà de [maxBytes] OCTETS (après décompression), le
     * fichier est supprimé et l'appel échoue : aucune pièce partielle ne reste.
     */
    fun download(
        url: String,
        dest: java.io.File,
        opts: RequestOpts = RequestOpts(),
        maxBytes: Int = MAX_RESPONSE_BYTES,
    ): Long {
        val parent = dest.parentFile
        if (parent != null && !parent.isDirectory && !parent.mkdirs()) {
            throw java.io.IOException("dossier de telechargement refuse")
        }
        try {
            val response = request("GET", url, opts, dest, maxBytes)
            if (!response.ok) {
                if (response.status == 429) {
                    throw RateLimitedError("Too many requests (http status: 429)", pronoteErrorCode = null, httpStatus = 429)
                }
                throw PronoteAPIError("Bad request (http status: ${response.status})", httpStatus = response.status)
            }
            return dest.length()
        } catch (e: Exception) {
            dest.delete()
            throw e
        }
    }

    /**
     * Corps BRUT vers un fichier temporaire, puis décompression BORNÉE vers
     * [dest]. `gzip` mentant (octets en clair) = le brut est conservé, comme
     * `gunzip`. Un dépassement ne laisse ni fichier partiel ni temporaire.
     */
    private fun streamToFile(
        stream: java.io.InputStream,
        dest: java.io.File,
        gzipped: Boolean,
        maxBytes: Int,
        deadline: RequestDeadline,
        cancellation: RequestCancellation?,
    ) {
        val parent = dest.parentFile ?: java.io.File(".")
        val temp = java.io.File.createTempFile("telechargement-", ".part", parent)
        try {
            stream.use { raw ->
                java.io.FileOutputStream(temp).use { copyBounded(raw, it, maxBytes, deadline, cancellation) }
            }
            if (gzipped) {
                try {
                    GZIPInputStream(java.io.FileInputStream(temp)).use { gz ->
                        java.io.FileOutputStream(dest).use { copyBounded(gz, it, maxBytes) }
                    }
                    temp.delete()
                } catch (_: Exception) {
                    // Pas un gzip valide : les octets BRUTS (déjà bornés) restent.
                    dest.delete()
                    if (!temp.renameTo(dest)) throw java.io.IOException("renommage du telechargement refuse")
                }
            } else if (!temp.renameTo(dest)) {
                throw java.io.IOException("renommage du telechargement refuse")
            }
        } catch (e: Exception) {
            dest.delete()
            throw e
        } finally {
            temp.delete()
        }
    }

    private fun request(
        method: String,
        url: String,
        opts: RequestOpts,
        downloadTo: java.io.File?,
        maxBytes: Int,
    ): HttpResponse {
        val maxRedirects = opts.maxRedirects
        val deadline = RequestDeadline(opts.deadlineMs ?: DEFAULT_REQUEST_DEADLINE_MS)
        val cancellation = opts.cancellation ?: RequestScope.current()
        var currentMethod = method
        var currentUrl = buildUrl(url, opts.params)
        var body: ByteArray? = null
        val headers = HashMap(baseHeaders)
        opts.headers?.let { headers.putAll(it) }
        // Sans cet en-tête, les grosses réponses (EDT, notes) remontent en
        // clair. N'écrase pas un en-tête déjà posé par l'appelant.
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
            cancellation?.throwIfCancelled()
            deadline.check()
            val remainingMs = deadline.remainingMs()
            if (remainingMs <= 0L) throw requestTimeout()
            val conn = URL(currentUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = minOf(CONNECT_TIMEOUT_MS, remainingMs).toInt()
            // Une seule valeur de timeout est posée AVANT `responseCode` : la
            // couche HTTP fige celle du socket. Elle sert d'en-têtes ET de
            // tranche de corps (2 s) ; l'échéance totale tranche à chaque lecture.
            conn.readTimeout = minOf(READ_SLICE_MS, remainingMs).toInt()
            conn.instanceFollowRedirects = false
            conn.requestMethod = currentMethod
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            val cookieHeader = jar.getCookieString(currentUrl)
            if (cookieHeader.isNotEmpty()) conn.setRequestProperty("Cookie", cookieHeader)
            var activeStream: java.io.InputStream? = null
            try {
                cancellation?.register(conn)
                cancellation?.throwIfCancelled()
                if (body != null && currentMethod != "GET" && currentMethod != "HEAD") {
                    conn.doOutput = true
                    conn.outputStream.use { it.write(body) }
                }
                val status = conn.responseCode
                deadline.check()
                cancellation?.throwIfCancelled()
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
                    // `Location` illisible : erreur réseau mappée.
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
                // Pas de `disconnect()` : le corps est lu jusqu'au bout, le socket
                // retourne au cache keep-alive et le POST suivant réutilise la
                // MÊME connexion (pas de handshake TCP+TLS).
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                if (stream != null) {
                    activeStream = stream
                    cancellation?.registerStream(stream)
                }
                // `Content-Encoding` absent = corps déjà en clair (la
                // décompression est faite par la plateforme quand c'est elle
                // qui a posé l'en-tête).
                val gzipped = header("content-encoding").any { it.trim().equals("gzip", ignoreCase = true) }
                // Téléchargement : le corps ne passe JAMAIS par un tampon
                // mémoire, même une pièce jointe de plusieurs Mio.
                if (downloadTo != null && status in 200..299) {
                    if (stream == null) {
                        java.io.FileOutputStream(downloadTo).close()
                    } else {
                        streamToFile(stream, downloadTo, gzipped, maxBytes, deadline, cancellation)
                    }
                    deadline.check()
                    cancellation?.throwIfCancelled()
                    return HttpResponse(
                        status = status,
                        ok = true,
                        url = currentUrl,
                        headers = received,
                        text = "",
                        content = ByteArray(0),
                    )
                }
                val raw: ByteArray = if (stream == null) ByteArray(0) else cappedBytes(stream, MAX_RESPONSE_BYTES, deadline, cancellation)
                deadline.check()
                cancellation?.throwIfCancelled()
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
                // TOUTE erreur referme le socket : la laisser ouverte remplit
                // le pool de connexions.
                try { conn.disconnect() } catch (_: Exception) {}
                throw e
            } finally {
                activeStream?.let { cancellation?.unregisterStream(it) }
                cancellation?.unregister(conn)
            }
        }
        // Inatteignable (la boucle retourne toujours), comme côté TS.
        throw IllegalStateException("Too many redirects")
    }

    fun get(url: String, opts: RequestOpts = RequestOpts()): HttpResponse = request("GET", url, opts)

    fun post(url: String, opts: RequestOpts = RequestOpts()): HttpResponse = request("POST", url, opts)
}

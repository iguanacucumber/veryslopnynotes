package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

/**
 * Authentification QR (+ `tokenLogin` pour le second tour 2FA), `post` avec
 * rejeu après `refresh`, lectures. Bloquant : jamais sur le thread UI.
 *
 * Les noms d'état gardent leur casse TS (`logged_in`, `periods_`) : ce sont des
 * clés de parité, pas du style.
 */

/** `login` + `jeton` chiffrés (hex), `url` porteuse. */
data class QrCode(val login: String, val jeton: String, val url: String)

data class ClientOptions(
    val ent: ((String, String, Map<String, String>) -> CookieJar?)? = null,
    val mode: String = "normal",
    val uuid: String = "",
    val accountPin: String? = null,
    val clientIdentifier: String? = null,
    val deviceName: String? = null,
    // Mémo des lectures (60 s) DÉSACTIVÉE par défaut : le harnais de parité
    // compare le fil de la référence TS. L'APP l'active (cf. `PairingRepository`).
    val memoizeReads: Boolean = false,
)

data class QrLoginOptions(
    val accountPin: String? = null,
    val clientIdentifier: String? = null,
    val deviceName: String? = null,
    val skip2fa: Boolean = false,
    val memoizeReads: Boolean = false,
)

data class ExportedCredentials(
    val pronoteUrl: String,
    val username: String,
    val password: String,
    val clientIdentifier: String?,
    val uuid: String,
)

data class InfoFilter(
    val onlyUnread: Boolean = false,
    val dateFrom: LocalDateTime? = null,
    val dateTo: LocalDateTime? = null,
)

/** Vérité JS d'une valeur (champs laissés bruts : `labels[l.N]`). */
internal fun jsTruthy(v: JVal?): Boolean = boolOf(v)

/** `String(v)` pour une CLÉ d'objet : absent → `"undefined"`, comme `labels[x]` en TS. */
internal fun jsKeyOf(v: JVal?): String = if (v == null) "undefined" else strOf(v)

open class ClientBase(
    var pronoteUrl: String,
    var username: String = "",
    var password: String = "",
    opts: ClientOptions = ClientOptions(),
) : PronoteClientLike {
    val ent = opts.ent
    var loginMode: String = opts.mode
    val uuid: String = opts.uuid
    val accountPin: String? = opts.accountPin
    var clientIdentifier: String? = opts.clientIdentifier
    val deviceName: String? = opts.deviceName

    /**
     * `null` = désactivée. Repart vide à chaque `refresh` et à chaque écriture.
     * `internal` : le harnais de parité y injecte une horloge.
     */
    internal var readMemo: ReadMemo? = if (opts.memoizeReads) ReadMemo() else null

    /**
     * `refresh()` remplace ces champs d'un bloc sous le moniteur de session ;
     * le `volatile` publie la nouvelle référence aux lecteurs HORS verrou
     * (ping de garde, pièces jointes, cache d'info).
     */
    @Volatile
    override lateinit var communication: Communication
    @Volatile
    var encryption = Encryption()
    @Volatile
    override var attributes: Map<String, String> = emptyMap()
    @Volatile
    override var funcOptions: JVal = JVal.Obj(LinkedHashMap())
    var userSettings: JVal = JVal.Obj(LinkedHashMap())
    lateinit var info: ClientInfo
    override val infoId: String? get() = info.id
    lateinit var startDay: LocalDateTime
    var week: Int = 0
    var logged_in: Boolean = false
    var lastConnection: LocalDateTime? = null
    var periods_: List<Period>? = null

    /**
     * UN refresh à la fois (CAS) : deux rafraîchissements font deux
     * `Communication` (deux cookies, deux compteurs) et le serveur répond `G=25`.
     */
    private val refreshGate = RefreshGate()

    /**
     * Un `G=25`/HTTP 429 arme une fenêtre de calme : aucune requête et AUCUN
     * refresh, c'est lui qui amplifie la limite. La porte se lève seule.
     */
    private val rateLimitGate = RateLimitGate()
    private var _expired: Boolean = false

    init {
        if (password.isEmpty() && username.isEmpty()) {
            throw PronoteAPIError("Please provide login credentials. Cookies are None, and username and password are empty.")
        }
        if (loginMode != "normal" && uuid.isEmpty()) {
            throw PronoteAPIError("UUID must not be empty")
        }
        if (ent != null) {
            pronoteUrl = pronoteUrl.replace("login=true", "")
        }
    }

    open fun ready(): ClientBase = this

    internal fun init() {
        val cookieJar = ent?.invoke(username, password, mapOf("pronote_url" to pronoteUrl))
        communication = Communication(pronoteUrl, cookieJar, loginMode != "normal")
        val (attrs, funcs) = communication.initialise(clientIdentifier)
        attributes = attrs
        funcOptions = funcs
        if (clientIdentifier == null) {
            clientIdentifier = (((funcs as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
                ?.fields?.get("data") as? JVal.Obj)?.fields?.get("identifiantNav")?.let {
                (it as? JVal.Str)?.value
            }
        }
        encryption = Encryption()
        encryption.aesIv = communication.encryption.aesIv
        startDay = dateParse(objAt(funcs, "dataSec", "data", "General", "PremierLundi", "V"))
        week = getWeek(LocalDateTime.now())
        periods_ = periods
        logged_in = login()
    }

    /** Accès directs : absent = jeté, comme en TS. */
    private fun objAt(root: JVal?, vararg keys: String): JVal? {
        var cur: JVal? = root
        for (k in keys) cur = (cur as? JVal.Obj)?.fields?.get(k) ?: throw ParsingError("Enveloppe illisible", keys.toList())
        return cur
    }


    private fun login(): Boolean {
        // `identifiant` absent = clé omise (comme `undefined` en TS).
        val unameRaw: String? = if (ent != null) attributes["e"] else username
        val pwdRaw: String? = if (ent != null) attributes["f"] else password
        val ident = LinkedHashMap<String, JVal>()
        ident["genreConnexion"] = JVal.Num(0.0)
        ident["genreEspace"] = JVal.Num(parseIntJs(attributes["a"] ?: ""))
        if (unameRaw != null) ident["identifiant"] = JVal.Str(unameRaw)
        ident["pourENT"] = JVal.Bool(ent != null)
        ident["enConnexionAuto"] = JVal.Bool(false)
        ident["demandeConnexionAuto"] = JVal.Bool(false)
        ident["demandeConnexionAppliMobile"] = JVal.Bool(loginMode == "qr_code")
        ident["demandeConnexionAppliMobileJeton"] = JVal.Bool(loginMode == "qr_code")
        ident["enConnexionAppliMobile"] = JVal.Bool(loginMode == "token")
        ident["uuidAppliMobile"] = JVal.Str(if (loginMode == "qr_code" || loginMode == "token") uuid else "")
        ident["loginTokenSAV"] = JVal.Str("")
        val idr = post("Identification", null, ident)
        val idrData = ((((idr as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)?.fields?.get("data")) as? JVal.Obj)
            ?: throw ParsingError("Identification sans data", listOf("dataSec", "data"))
        val e = Encryption()
        e.aesSetIv(communication.encryption.aesIv)
        // ENT : `e`/`f` ABSENTS = `"undefined"` et le login continue ; le `!!`
        // jetait là où la référence enchaîne. Hors ENT, jamais nuls.
        var uname = unameRaw ?: "undefined"
        var pwd = pwdRaw ?: "undefined"
        if (ent != null) {
            val motdepasse = sha256HexUpper(pwd)
            e.aesSetKey(motdepasse.toByteArray(Charsets.UTF_8))
        } else {
            if (jsTruthy(idrData.fields["modeCompLog"])) uname = uname.lowercase()
            if (jsTruthy(idrData.fields["modeCompMdp"])) pwd = pwd.lowercase()
            val aleaRaw = idrData.fields["alea"]
            val alea = if (aleaRaw == null || aleaRaw is JVal.Null) "" else strOf(aleaRaw)
            val motdepasse = sha256HexUpper(alea + pwd)
            e.aesSetKey((uname + motdepasse).toByteArray(Charsets.UTF_8))
        }
        val challengeRaw = idrData.fields["challenge"] as? JVal.Str
            ?: throw ParsingError("Challenge manquant", listOf("dataSec", "data", "challenge"))
        val ch: String
        try {
            ch = e.aesEncrypt(challengeRaw.value.toByteArray(Charsets.UTF_8)).toHexLower()
        } catch (ex: CryptoError) {
            val hint = if (loginMode == "qr_code") {
                "exception happened during login -> probably the qr code has expired (qr code is valid during 10 minutes)"
            } else {
                "exception happened during login -> probably bad username/password"
            }
            throw CryptoError("${ex.message} | $hint")
        }
        val auth = LinkedHashMap<String, JVal>()
        auth["connexion"] = JVal.Num(0.0)
        auth["challenge"] = JVal.Str(ch)
        auth["espace"] = JVal.Num(parseIntJs(attributes["a"] ?: ""))
        val authResponse = post("Authentification", null, auth)
        val authData = ((((authResponse as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)?.fields?.get("data")) as? JVal.Obj)
            ?: throw ParsingError("Authentification sans data", listOf("dataSec", "data"))
        if (!authData.fields.containsKey("cle")) return false.also { logged_in = false }
        communication.afterAuth(authResponse, e.aesKey)
        // Le client garde la clé d'AUTH, la communication a la clé de SESSION.
        encryption.aesKey = e.aesKey
        val doubleAuth = authData.fields["actionsDoubleAuth"] as? JVal.Obj
        if (doubleAuth != null) {
            val actions = Json.parse(strOf(doubleAuth.fields["V"])) as? JVal.Arr
                ?: throw ParsingError("actionsDoubleAuth illisibles", listOf("actionsDoubleAuth", "V"))
            val nums = actions.items.map { (it as? JVal.Num)?.value }
            do2fa(nums.contains(3.0), nums.contains(5.0) || nums.contains(3.0), accountPin, deviceName)
        }
        val lastConn = authData.fields["derniereConnexion"]
        // Falsy = `null` ; sinon `.V` direct (non-objet = jeté).
        lastConnection = if (jsTruthy(lastConn)) datetimeParse((lastConn as JVal.Obj).fields["V"]) else null
        if ((loginMode == "qr_code" || loginMode == "token") && jsTruthy(authData.fields["jetonConnexionAppliMobile"])) {
            password = strOf(authData.fields["jetonConnexionAppliMobile"])
        }
        userSettings = post("ParametresUtilisateur", null, null)
        val ressource = (((userSettings as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
            ?.fields?.get("data") as? JVal.Obj)?.fields?.get("ressource")
        info = ClientInfo(this, ressource)
        communication.authorizedOnglets =
            prepareOnglets((((userSettings as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
                ?.fields?.get("data") as? JVal.Obj)?.fields?.get("listeOnglets"))
        return true.also { logged_in = true }
    }

    private fun do2fa(doVerifyPin: Boolean, doRegisterDevice: Boolean, pin: String?, identifier: String?) {
        var encryptedPin: String? = null
        if (doVerifyPin) {
            if (pin == null) throw MFAError("PIN is required for this account")
            encryptedPin = communication.encryption
                .aesEncrypt(pin.toByteArray(Charsets.UTF_8)).toHexLower()
            val resp = post(
                "SecurisationCompteDoubleAuth", null,
                mapOf("action" to JVal.Num(0.0), "codePin" to JVal.Str(encryptedPin)),
            )
            val result = ((((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)?.fields?.get("data")) as? JVal.Obj)
                ?.fields?.get("result")
            if (!jsTruthy(result)) throw MFAError("Invalid PIN")
        }
        if (doRegisterDevice) {
            if (identifier == null) throw MFAError("A device identifier is required for this account")
            val data = LinkedHashMap<String, JVal>()
            data["action"] = JVal.Num(3.0)
            data["avecIdentification"] = JVal.Bool(true)
            data["strIdentification"] = JVal.Str(identifier)
            if (encryptedPin != null) data["codePin"] = JVal.Str(encryptedPin)
            post("SecurisationCompteDoubleAuth", null, data)
        }
    }

    fun exportCredentials(): ExportedCredentials = ExportedCredentials(
        pronoteUrl = pronoteUrl,
        username = username,
        password = password,
        clientIdentifier = clientIdentifier,
        uuid = uuid,
    )

    /** Semaine PRONOTE (lundi = 1er jour), depuis `PremierLundi`. */
    override fun getWeek(date: LocalDateTime): Int {
        val days = (date.toLocalDate().toEpochDay() - startDay.toLocalDate().toEpochDay()).toInt()
        return 1 + Math.floorDiv(days, 7)
    }

    /** Reconstruits à chaque accès sauf cache `periods_` non vide. */
    val periods: List<Period>
        get() {
            val cached = periods_
            if (!cached.isNullOrEmpty()) return cached
            val items = ((((funcOptions as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
                ?.fields?.get("data") as? JVal.Obj)?.fields?.get("General") as? JVal.Obj)
                ?.fields?.get("ListePeriodes") as? JVal.Arr
            return (items?.items
                ?: throw ParsingError("ListePeriodes manquante", listOf("General", "ListePeriodes")))
                .map { Period(this, it) }
        }

    /** Le `post("Navigation", …)` est branché ici, pas dans le modèle. */
    fun keepAlive(): KeepAlive = KeepAlive(
        shouldPing = { System.currentTimeMillis() / 1000 - communication.lastPing >= 110 },
        pingRequest = {
            post(
                "Navigation", 7.0,
                mapOf("onglet" to JVal.Num(7.0), "ongletPrec" to JVal.Num(7.0)),
            )
        },
    )

    /**
     * Re-poignée de main + re-login (l'ENT injecté est rejoué).
     *
     * `refresh` et `post` partagent le moniteur : le remplacement de
     * `communication`/`attributes`/clé AES n'attrape JAMAIS une requête en vol.
     */
    @Synchronized
    open fun refresh() {
        // Session neuve : les lectures mémoïsées sont de l'ancien monde.
        readMemo?.clear()
        val cookieJar = ent?.invoke(username, password, mapOf("pronote_url" to pronoteUrl))
        communication = Communication(pronoteUrl, cookieJar, loginMode != "normal")
        val (attrs, funcs) = communication.initialise(clientIdentifier)
        attributes = attrs
        funcOptions = funcs
        encryption = Encryption()
        encryption.aesIv = communication.encryption.aesIv
        login()
        periods_ = null
        periods_ = periods
        week = getWeek(LocalDateTime.now())
        _expired = true
    }


    /**
     * Enveloppe `{Signature, data}` (`Signature` omise si onglet nul/zéro/NaN,
     * `data` omise si nulle), mémo des lectures et rejeu unique après `refresh`.
     *
     * `post` et `refresh` partagent le moniteur : deux rafraîchissements
     * concurrents (job de fond + interface) donnaient deux `Communication` et
     * une clé AES mélangée. Le perdant ATTEND puis rejoue sur la session neuve.
     */
    @Synchronized
    override fun post(functionName: String, onglet: Double?, data: Map<String, JVal>?): JVal {
        val postData = LinkedHashMap<String, JVal>()
        if (onglet != null && onglet != 0.0 && !onglet.isNaN()) {
            postData["Signature"] = JVal.Obj(linkedMapOf("onglet" to JVal.Num(onglet)))
        }
        if (data != null) postData["data"] = JVal.Obj(LinkedHashMap(data))
        // La MÊME lecture ne part qu'une fois par minute. Une fonction HORS
        // liste blanche (écriture, ping, auth) VIDE la mémo.
        val memo = readMemo
        val key = memo?.keyFor(functionName, onglet, JVal.Obj(postData))
        if (key == null) {
            memo?.clear()
            return sendWithRefresh(functionName, postData)
        }
        memo.get(key)?.let { return it }
        val response = sendWithRefresh(functionName, postData)
        // Seule une RÉUSSITE est mémorisée.
        memo.put(key, response)
        return response
    }

    /**
     * Envoi effectif, avec rejeu unique après `refresh` sur `PronoteAPIError`
     * (`ExpiredObject` remonte tel quel).
     *
     * `send`/`refresh` ouverts pour les TESTS : un stub compte les requêtes
     * sans réseau, et le pilote de rate-limit prouve qu'aucun refresh ne part.
     */
    private fun sendWithRefresh(functionName: String, postData: Map<String, JVal>): JVal {
        // Fenêtre de calme : échec immédiat, sans requête ni refresh — le seul
        // chemin qui empêche la boucle « G=25 -> refresh -> login -> G=25 ».
        rateLimitGate.check()
        try {
            return send(functionName, postData)
        } catch (e: RateLimitedError) {
            // Ne surtout pas rafraîchir : armer la porte, rendre l'erreur telle quelle.
            rateLimitGate.trip()
            throw e
        } catch (e: ExpiredObject) {
            throw e
        } catch (e: PronoteAPIError) {
            // Un rafraîchissement est DÉJÀ en cours : ne pas le doubler.
            if (!refreshGate.tryEnter()) throw e
            try {
                refresh()
            } catch (rate: RateLimitedError) {
                // Le refresh tombe sur la limite : la session n'est pas morte,
                // on attend.
                rateLimitGate.trip()
                throw rate
            } finally {
                refreshGate.leave()
            }
            return try {
                send(functionName, postData)
            } catch (e: RateLimitedError) {
                // Rejeu refusé aussi : armer la porte évite une 3e tentative.
                rateLimitGate.trip()
                throw e
            }
        }
    }

    /** POST effectif (surchargeable par les tests). */
    internal open fun send(functionName: String, postData: Map<String, JVal>): JVal =
        communication.post(functionName, postData)

}

/**
 * Client élève (lectures + écritures devoir/discussion). `open` : le harnais de
 * parité en dérive un client dont l'envoi est un STUB qui compte les requêtes.
 */
open class Client(
    pronoteUrl: String,
    username: String = "",
    password: String = "",
    opts: ClientOptions = ClientOptions(),
) : ClientBase(pronoteUrl, username, password, opts) {
    companion object {
        fun login(pronoteUrl: String, username: String, password: String, opts: ClientOptions = ClientOptions()): Client {
            val client = Client(pronoteUrl, username, password, opts)
            client.init()
            return client
        }

        /**
         * Établissement de DÉMONSTRATION public : ni QR, ni PIN. C'est le client
         * qui ouvre la session, le dépôt ne fait que la publier.
         */
        fun demoLogin(): Client = DemoSchool.login()

        /**
         * `login`/`jeton` déchiffrés par le PIN, URL réécrite (`mobile.`,
         * `login=true`), UA iPhone, second tour `token` si la sécurisation
         * l'exige.
         */
        fun qrcodeLogin(qrCode: QrCode, pin: String, uuid: String, opts: QrLoginOptions = QrLoginOptions()): Client {
            val encryption = Encryption()
            encryption.aesSetKey(pin.toByteArray(Charsets.UTF_8))
            val (login, jeton) = decryptQr(encryption, qrCode)
            val client = Client(
                rewriteQrUrl(qrCode.url),
                login, jeton,
                ClientOptions(mode = "qr_code", uuid = uuid, accountPin = opts.accountPin, clientIdentifier = opts.clientIdentifier, deviceName = opts.deviceName, memoizeReads = opts.memoizeReads),
            )
            // Un PIN faux a déjà jeté `QRCodeDecryptError`.
            client.init()
            client.loginMode = "token"
            if (!opts.skip2fa) {
                val resp = client.post("PageInfosPerso", 49.0, null)
                val mode = (((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
                    ?.fields?.get("data") as? JVal.Obj)?.fields?.get("securisation")?.let {
                    ((it as? JVal.Obj)?.fields?.get("mode") as? JVal.Num)?.value
                } ?: 0.0
                if (mode == 0.0) return client
                val creds = client.exportCredentials()
                return tokenLogin(
                    creds.pronoteUrl, creds.username, creds.password, creds.uuid,
                    ClientOptions(accountPin = opts.accountPin, clientIdentifier = creds.clientIdentifier, deviceName = opts.deviceName, memoizeReads = opts.memoizeReads),
                )
            }
            return client
        }

        private fun decryptQr(encryption: Encryption, qrCode: QrCode): Pair<String, String> {
            try {
                return Pair(
                    encryption.aesDecrypt(qrCode.login.hexToBytes()).toString(Charsets.UTF_8),
                    encryption.aesDecrypt(qrCode.jeton.hexToBytes()).toString(Charsets.UTF_8),
                )
            } catch (e: CryptoError) {
                throw QRCodeDecryptError("invalid confirmation code")
            } catch (e: IllegalArgumentException) {
                // Hex malformé : le TS échoue ensuite au déchiffrement vers le
                // MÊME `QRCodeDecryptError` (équivalence d'issue, prouvée par la parité).
                throw QRCodeDecryptError("invalid confirmation code")
            }
        }

        internal fun rewriteQrUrl(raw: String): String {
            // Comme `new URL()` : userinfo gardée, IPv6 entre crochets, ports par
            // défaut omis, hash vidé.
            // ponytail: `.../pronote` -> `.../pronote/eleve.html` (sinon 404 ->
            // school_unreachable). URL malformée -> IllegalArgumentException (bad_request).
            val uri = try {
                java.net.URI(raw.trim())
            } catch (e: Exception) {
                throw IllegalArgumentException("URL sans hote : $raw")
            }
            // `new URL()` met le schéma en minuscules, `URI` le garde tel quel.
            val scheme = uri.scheme?.lowercase() ?: throw IllegalArgumentException("URL sans hôte : $raw")
            val authority = uri.rawAuthority ?: throw IllegalArgumentException("URL sans hôte : $raw")
            // `URI.getHost()` vaut NULL si l'autorité n'est pas « serveur »
            // (underscore, IDN, espace) : découpage à la main, comme `new URL()`.
            val at = authority.lastIndexOf('@')
            val userinfo = if (at >= 0) "${authority.substring(0, at)}@" else ""
            val hostPort = if (at >= 0) authority.substring(at + 1) else authority
            val (rawHost, port) = hostPortOf(hostPort, raw)
            if (rawHost.isEmpty()) throw IllegalArgumentException("URL sans hôte : $raw")
            val host = hostOf(rawHost, raw)
            var normPath = uri.path ?: ""
            // `new URL()` : le chemin vaut toujours "/" au moins.
            if (normPath.isEmpty()) normPath = "/"
            val noTrail = if (normPath.endsWith("/") && normPath.length > 1) normPath.dropLast(1) else normPath
            if (noTrail.endsWith("/pronote")) normPath = "$noTrail/eleve.html"
            val segs = normPath.split("/").toMutableList()
            if (!segs.last().startsWith("mobile.")) segs[segs.size - 1] = "mobile." + segs.last()
            val defaultPort = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
            val portPart = if (port == -1 || defaultPort) "" else ":$port"
            return "$scheme://$userinfo$host$portPart${segs.joinToString("/")}" +
                "?fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true"
        }

        /**
         * `hote`, `hote:port` ou `[v6]:port` ; crochets IPv6 conservés. Port -1
         * quand l'autorité n'en porte pas (`hote:` = port par défaut).
         */
        private fun hostPortOf(hostPort: String, raw: String): Pair<String, Int> {
            if (hostPort.startsWith("[")) {
                val close = hostPort.indexOf(']')
                if (close < 0) throw IllegalArgumentException("URL sans hôte : $raw")
                val rest = hostPort.substring(close + 1)
                val port = when {
                    rest.isEmpty() -> -1
                    rest.startsWith(":") -> portOf(rest.substring(1), raw)
                    else -> throw IllegalArgumentException("URL sans hôte : $raw")
                }
                return Pair(hostPort.substring(0, close + 1), port)
            }
            val colon = hostPort.lastIndexOf(':')
            if (colon < 0) return Pair(hostPort, -1)
            val host = hostPort.substring(0, colon)
            // Un hôte ne porte pas de ':' : `hote:port:port` est invalide.
            if (":" in host) throw IllegalArgumentException("URL sans hôte : $raw")
            return Pair(host, portOf(hostPort.substring(colon + 1), raw))
        }

        /** Vide = port par défaut ; hors 0..65535 = invalide. */
        private fun portOf(port: String, raw: String): Int {
            if (port.isEmpty()) return -1
            val value = port.toIntOrNull() ?: throw IllegalArgumentException("URL sans hôte : $raw")
            if (value < 0 || value > 65535) throw IllegalArgumentException("URL sans hôte : $raw")
            return value
        }

        /**
         * Minuscules, puis punycode pour un IDN.
         * ponytail: `IDN` est IDNA2003, le TS est UTS46 (`ß` diverge) — lettre
         * allemande, pas d'établissement français.
         */
        private fun hostOf(host: String, raw: String): String {
            val lower = host.lowercase()
            if (lower.all { it.code < 128 }) return lower
            return try {
                java.net.IDN.toASCII(lower)
            } catch (e: IllegalArgumentException) {
                throw IllegalArgumentException("URL sans hôte : $raw")
            }
        }

        fun tokenLogin(pronoteUrl: String, username: String, password: String, uuid: String, opts: ClientOptions = ClientOptions()): Client {
            // `ent` jamais propagé (le TS reconstruit ses opts sans `ent`).
            val client = Client(
                pronoteUrl, username, password,
                opts.copy(mode = "token", uuid = uuid, ent = null),
            )
            client.init()
            return client
        }
    }


    /** Semaines balayées, filtrés sur la fenêtre, bornes incluses. */
    fun lessons(dateFrom: LocalDateTime, dateTo: LocalDateTime?): List<Lesson> {
        // `Ressource` absente = clés omises (comme `undefined` en TS).
        val user = userResource()
        val base = LinkedHashMap<String, JVal>()
        if (user != null) {
            base["ressource"] = user
            base["Ressource"] = user
        }
        base["avecAbsencesEleve"] = JVal.Bool(false)
        base["avecConseilDeClasse"] = JVal.Bool(true)
        base["estEDTPermanence"] = JVal.Bool(false)
        base["avecAbsencesRessource"] = JVal.Bool(true)
        base["avecDisponibilites"] = JVal.Bool(true)
        base["avecInfosPrefsGrille"] = JVal.Bool(true)
        val from = LocalDateTime.of(dateFrom.year, dateFrom.monthValue, dateFrom.dayOfMonth, 0, 0, 0)
        val to = if (dateTo != null) {
            LocalDateTime.of(dateTo.year, dateTo.monthValue, dateTo.dayOfMonth, 23, 59, 59, 999000000)
        } else {
            LocalDateTime.of(dateFrom.year, dateFrom.monthValue, dateFrom.dayOfMonth, 23, 59, 59, 999000000)
        }
        val out = mutableListOf<Lesson>()
        for (week in getWeek(from)..getWeek(to)) {
            val data = LinkedHashMap(base)
            data["NumeroSemaine"] = JVal.Num(week.toDouble())
            data["numeroSemaine"] = JVal.Num(week.toDouble())
            val resp = post("PageEmploiDuTemps", 16.0, data)
            val courses = ((((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
                ?.fields?.get("data") as? JVal.Obj)?.fields?.get("ListeCours") as? JVal.Arr)?.items
                ?: throw ParsingError("ListeCours manquante", listOf("dataSec", "data", "ListeCours"))
            for (c in courses) out.add(Lesson(this, c))
        }
        return out.filter { it.start >= from && it.start <= to }
    }

    /** Semaines `premier..dernier`, filtrés sur la fenêtre. */
    fun homework(dateFrom: LocalDateTime, dateTo: LocalDateTime?): List<Homework> {
        // `DerniereDate.V` : l'objet seul n'est pas une date.
        val to = dateTo ?: dateParse((dataGeneral() as? JVal.Obj)?.fields?.get("DerniereDate")?.let { (it as? JVal.Obj)?.fields?.get("V") })
        val resp = post(
            "PageCahierDeTexte", 88.0,
            mapOf("domaine" to jobjOf("_T" to JVal.Num(8.0), "V" to JVal.Str("[${getWeek(dateFrom)}..${getWeek(to)}]"))),
        )
        val items = ((((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
            ?.fields?.get("data") as? JVal.Obj)?.fields?.get("ListeTravauxAFaire") as? JVal.Obj)
            ?.fields?.get("V") as? JVal.Arr
        val out = mutableListOf<Homework>()
        for (h in items?.items ?: throw ParsingError("ListeTravauxAFaire manquante", listOf("dataSec", "data", "ListeTravauxAFaire", "V"))) {
            val hw = Homework(this, h)
            if (hw.date >= dateFrom && hw.date <= to) out.add(hw)
        }
        return out
    }

    private fun dataGeneral(): JVal? =
        ((((funcOptions as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
            ?.fields?.get("data") as? JVal.Obj)?.fields?.get("General") as? JVal.Obj)

    private fun objStr(obj: JVal?, key: String): JVal? = (obj as? JVal.Obj)?.fields?.get(key)

    private fun userResource(): JVal? =
        ((((userSettings as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
            ?.fields?.get("data") as? JVal.Obj)?.fields?.get("ressource"))

    /** Enseignants `G:3` puis vie sco `G:34`, dans cet ordre. */
    fun getRecipients(): List<Recipient> {
        val out = mutableListOf<Recipient>()
        for (g in listOf(3.0, 34.0)) {
            val resp = post(
                "ListeRessourcesPourCommunication", 131.0,
                mapOf("onglet" to jobjOf("N" to JVal.Num(0.0), "G" to JVal.Num(g))),
            )
            val items = (((((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
                ?.fields?.get("data") as? JVal.Obj)?.fields?.get("listeRessourcesPourCommunication") as? JVal.Obj)
                ?.fields?.get("V") as? JVal.Arr)?.items
                ?: throw ParsingError("listeRessourcesPourCommunication manquante", listOf("dataSec", "data", "listeRessourcesPourCommunication", "V"))
            for (r in items) out.add(Recipient(this, r))
        }
        return out
    }

    /** Aucun id renvoyé, comme en TS. */
    fun newDiscussion(subject: String, message: String, recipients: List<Recipient>) {
        post(
            "SaisieMessage", 131.0,
            mapOf(
                "objet" to JVal.Str(subject),
                "contenu" to JVal.Str(message),
                "listeDestinataires" to JVal.Arr(
                    recipients.map {
                        jobjOf("N" to JVal.Str(it.id), "G" to JVal.Num(it._type), "L" to JVal.Str(it.name))
                    },
                ),
            ),
        )
    }

    /** Premier niveau (`estUneDiscussion`, profondeur 0), non-lus filtrables. */
    fun discussions(onlyUnread: Boolean = false): List<Discussion> {
        val resp = post(
            "ListeMessagerie", 131.0,
            mapOf("avecMessage" to JVal.Bool(true), "avecLu" to JVal.Bool(!onlyUnread)),
        )
        val data = ((((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)?.fields?.get("data")) as? JVal.Obj)
            ?: throw ParsingError("ListeMessagerie sans data", listOf("dataSec", "data"))
        val labelsRaw = ((data.fields["listeEtiquettes"] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)?.items
            ?: throw ParsingError("listeEtiquettes manquante", listOf("dataSec", "data", "listeEtiquettes", "V"))
        val labels = LinkedHashMap<String, String>()
        for (l in labelsRaw) {
            val o = l as? JVal.Obj ?: continue
            val g = o.fields["G"] ?: continue
            labels[jsKeyOf(o.fields["N"])] = jsKeyOf(g)
        }
        val items = ((data.fields["listeMessagerie"] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)?.items
            ?: throw ParsingError("listeMessagerie manquante", listOf("dataSec", "data", "listeMessagerie", "V"))
        return items.mapNotNull { d ->
            val o = d as? JVal.Obj ?: return@mapNotNull null
            val isDiscussion = jsTruthy(o.fields["estUneDiscussion"])
            val depth = (o.fields["profondeur"] as? JVal.Num)?.value ?: 1.0
            if (!(isDiscussion && depth == 0.0)) return@mapNotNull null
            Discussion(this, d, labels)
        }
    }

    /** Actus + sondages, filtrés sur `startDate` présent. */
    fun informationAndSurveys(opts: InfoFilter = InfoFilter()): List<Information> {
        val resp = post(
            "PageActualites", 8.0,
            mapOf("modesAffActus" to jobjOf("_T" to JVal.Num(26.0), "V" to JVal.Str("[0..3]"))),
        )
        val modes = ((((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
            ?.fields?.get("data") as? JVal.Obj)?.fields?.get("listeModesAff") as? JVal.Arr)?.items
            ?: throw ParsingError("listeModesAff manquante", listOf("dataSec", "data", "listeModesAff"))
        var info = mutableListOf<Information>()
        for (liste in modes) {
            val items = (((liste as? JVal.Obj)?.fields?.get("listeActualites") as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)?.items
                ?: throw ParsingError("listeActualites manquante", listOf("listeActualites", "V"))
            for (i in items) info.add(Information(this, i))
        }
        if (opts.onlyUnread) info = info.filter { !it.read }.toMutableList()
        if (opts.dateFrom != null) info = info.filter { it.startDate != null && opts.dateFrom <= it.startDate }.toMutableList()
        if (opts.dateTo != null) info = info.filter { it.startDate != null && it.startDate < opts.dateTo }.toMutableList()
        return info
    }

    /**
     * TEXTE BRUT, 1 POST `PageActualites` : la liste ne télécharge pas les corps,
     * ils se chargent à la demande, au dépliage.
     */
    fun informationContent(id: String): String =
        informationBodyText(informationQuestions(this, id))

    /** Semaines balayées, `Date` injectée par jour, filtré sur la fenêtre. */
    fun menus(dateFrom: LocalDateTime, dateTo: LocalDateTime?): List<Menu> {
        val to = dateTo ?: dateFrom
        val out = mutableListOf<Menu>()
        var firstDay = dateFrom.minusDays((dateFrom.dayOfWeek.value - 1).toLong())
        while (firstDay <= to) {
            val resp = post(
                "PageMenus", 10.0,
                mapOf("date" to jobjOf("_T" to JVal.Num(7.0), "V" to JVal.Str("${frDate(firstDay)} 0:0:0"))),
            )
            val days = ((((resp as? JVal.Obj)?.fields?.get("dataSec") as? JVal.Obj)
                ?.fields?.get("data") as? JVal.Obj)?.fields?.get("ListeJours") as? JVal.Obj)
                ?.fields?.get("V") as? JVal.Arr
            for (dayJson in days?.items ?: throw ParsingError("ListeJours manquante", listOf("dataSec", "data", "ListeJours", "V"))) {
                val day = dayJson as? JVal.Obj ?: continue
                val meals = ((day.fields["ListeRepas"] as? JVal.Obj)?.fields?.get("V") as? JVal.Arr)?.items ?: continue
                for (menu in meals) {
                    val o = (menu as? JVal.Obj)?.fields ?: continue
                    val withDate = LinkedHashMap(o)
                    withDate["Date"] = day.fields["Date"] ?: JVal.Null
                    out.add(Menu(this, JVal.Obj(withDate)))
                }
            }
            firstDay = firstDay.plusDays(7)
        }
        return out.filter { it.date >= dateFrom && it.date <= to }
    }

    private fun jobjOf(vararg ps: Pair<String, JVal>): JVal.Obj =
        JVal.Obj(LinkedHashMap<String, JVal>().also { m -> ps.forEach { m[it.first] = it.second } })
}

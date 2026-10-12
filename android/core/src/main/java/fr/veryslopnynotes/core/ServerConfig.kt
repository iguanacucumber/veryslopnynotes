package fr.veryslopnynotes.core

// Résultat de validation d'une adresse de serveur SAISIE PAR L'UTILISATEUR
// (choix à l'exécution, écran d'appairage). `Ok` = forme canonique à
// persister ; `Rejected` = message français actionnable et RIEN n'est modifié.
// Aucun des deux ne contient l'adresse saisie : elle ne part ni dans un log,
// ni dans un message de crash (elle révèle l'établissement, règle d'or).
sealed interface ServerUrlResult {
    data class Ok(val baseUrl: String) : ServerUrlResult
    data class Rejected(val message: String) : ServerUrlResult
}

// Config allowlist du scraper unique (#209, #206) : la valeur de BuildConfig
// (local.properties `server.host` ou env SERVER_HOST) n'est plus qu'une GRAINE
// par défaut, quand rien n'est choisi à l'exécution. HTTPS-only sauf hôtes
// émulateur (10.0.2.2/localhost). Aucun hôte tiers, aucune URL en dur ici :
// l'allowlist tient désormais dans `validateBaseUrl`, qui borne et normalise
// la saisie. L'app ne parle plus métier à personne : le téléphone lit
// l'établissement en direct (ADR-003), le scraper ne sert que des manuels.
object ServerConfig {
    const val SCHEME_PLACEHOLDER = "https"
    const val HOST_PLACEHOLDER = "server-host-configured-at-build"

    /**
     * Bornes de saisie : au-delà, ce n'est plus une adresse de serveur. Le
     * plafond global (300) laisse la place au plafond de domaine (253, maximum
     * DNS) : sinon la borne de domaine serait inatteignable et donc morte.
     */
    const val MAX_BASE_URL_CHARS = 300
    const val MAX_AUTHORITY_CHARS = 253

    private const val MAX_LABEL_CHARS = 63
    private const val MAX_PORT = 65535
    // Messages de refus : une cause, une correction, jamais l'adresse saisie
    // (elle ne doit apparaître ni dans un log ni dans un message de crash).
    private const val PORT_HINT = "Port invalide : utilisez un nombre entre 1 et 65535."
    private const val HOST_HINT = "Domaine invalide : utilisez un nom de domaine, une IPv4 ou une IPv6 entre crochets."

    fun baseUrl(scheme: String = SCHEME_PLACEHOLDER, host: String = HOST_PLACEHOLDER): String =
        "$scheme://$host"

    fun isEmulatorHost(host: String): Boolean =
        host.startsWith("10.0.2.2") || host.startsWith("localhost")

    /**
     * Hôtes Loopback au sens ÉGALITÉ STRICTE : `isEmulatorHost` compare par
     * préfixe (miroir de la règle Gradle), donc « 10.0.2.234 » ou
     * « localhost.evil.tld » y passent. Or c'est cette liste qui décide si du
     * HTTP clair est accepté : un préfixe trop laxiste enverrait les
     * credentials du portail en clair vers un hôte arbitraire. On exige donc
     * l'égalité, plus la boucle locale classique (127.0.0.0/8, ::1) utile en dev.
     */
    fun isLoopbackHost(host: String): Boolean {
        val bare = if (host.startsWith("[") && host.endsWith("]")) host.substring(1, host.length - 1) else host
        return bare == "10.0.2.2" || bare == "localhost" || bare == "::1" || (isIpv4(bare) && bare.startsWith("127."))
    }

    fun schemeFor(host: String): String =
        if (isEmulatorHost(host)) "http" else "https"

    /**
     * Valide et NORMALISE l'adresse du serveur choisi à l'exécution. C'est
     * TOUT ce qui sépare encore l'app d'un hôte unique : la saisie est libre,
     * donc la contrainte est ici, pas dans une constante de build.
     *
     * Forme acceptée : `https://hôte[:port]` (ou `http` si et seulement si
     * l'hôte est l'émulateur ou la boucle locale — `isLoopbackHost`, égalité
     * stricte, donc inattaquable depuis l'extérieur). Hôte = IPv4, IPv6
     * littérale entre crochets, ou nom DNS ; port 1-65535.
     *
     * Sont REFUSÉS, avec un message qui dit quoi corriger : identifiants
     * `user:pass@`, chemin, query, fragment, espaces et caractères de contrôle,
     * schémas autres que http/https, ports hors bornes, IP à zéro initial
     * (lecture octale divergente selon le résolveur), IPv6 sans crochets,
     * adresses trop longues. La forme canonique est minusculisée et débarrassée
     * d'une barre oblique finale, donc `https://hôte/` et `https://Hôte` sont
     * acceptés comme `https://hôte`.
     *
     * ponytail: validation à la main plutôt que `java.net.URI`, qui accepte
     * `@`, chemins et espaces et qu'il faudrait encore borner. Upgrade:
     * java.net.URI + comparaison de composants si un jour la liste des formes
     * acceptées doit s'élargir.
     */
    fun validateBaseUrl(raw: String): ServerUrlResult {
        val input = raw.trim()
        if (input.isEmpty()) {
            return rejected("Adresse vide : saisissez l'adresse de votre serveur.")
        }
        if (input.length > MAX_BASE_URL_CHARS) {
            return rejected("Adresse trop longue ($MAX_BASE_URL_CHARS caractères maximum).")
        }
        // Espace ou caractère de contrôle : il se retrouverait tel quel dans
        // l'URL de requête (ou dans un en-tête), donc refus sans exception.
        if (input.any { it.isWhitespace() || it.isISOControl() }) {
            return rejected("Espace ou caractère interdit dans l'adresse.")
        }
        val sep = input.indexOf("://")
        if (sep <= 0) {
            return rejected("Adresse incomplète : le format attendu est https://domaine[:port].")
        }
        val scheme = input.substring(0, sep).lowercase()
        if (scheme != "https" && scheme != "http") {
            return rejected("Schéma refusé : utilisez https (http est réservé à l'émulateur et à la boucle locale).")
        }
        // Barre oblique finale tolérée (collée depuis un navigateur) ; toute
        // autre barre oblique = chemin, refusé plus bas.
        val authority = input.substring(sep + 3).lowercase().trimEnd('/')
        if (authority.isEmpty()) {
            return rejected("Domaine manquant après le schéma.")
        }
        if (authority.length > MAX_AUTHORITY_CHARS) {
            return rejected("Domaine trop long ($MAX_AUTHORITY_CHARS caractères maximum).")
        }
        if (authority.contains('@')) {
            return rejected("Identifiants (utilisateur:mot de passe@) refusés : saisissez seulement le domaine.")
        }
        if (authority.contains('/')) {
            return rejected("Chemin refusé : saisissez seulement le domaine et le port.")
        }
        if (authority.contains('?') || authority.contains('#')) {
            return rejected("Paramètres ou ancre refusés : saisissez seulement le domaine et le port.")
        }
        if (authority.any { !isAuthorityChar(it) }) {
            return rejected("Caractère interdit dans le domaine.")
        }
        val parts = splitAuthority(authority)
            // Plusieurs ':' = forme d'hôte cassée (IPv6 sans crochets) plutôt
            // qu'un port : le message doit dire quoi corriger.
            ?: return rejected(if (authority.count { it == ':' } > 1) HOST_HINT else PORT_HINT)
        if (!isValidHost(parts.host)) return rejected(HOST_HINT)
        if (parts.port != null && !isValidPort(parts.port)) return rejected(PORT_HINT)
        // Le seul cas où le clair est toléré, et c'est une adresse de
        // développement : aucun texte saisi ne peut en élargir la portée.
        if (scheme == "http" && !isLoopbackHost(parts.host)) {
            return rejected("HTTP est réservé à l'émulateur et à la boucle locale : utilisez l'adresse https de votre serveur.")
        }
        return ServerUrlResult.Ok("$scheme://$authority")
    }

    private fun rejected(message: String): ServerUrlResult = ServerUrlResult.Rejected(message)

    private fun isAuthorityChar(c: Char): Boolean =
        c in 'a'..'z' || c in '0'..'9' || c == '.' || c == '-' || c == ':' || c == '[' || c == ']'

    /** Hôte + port optionnel ; null = authority illisible (crochet, port). */
    private data class HostPort(val host: String, val port: String?)

    private fun splitAuthority(authority: String): HostPort? {
        if (authority.startsWith("[")) {
            val end = authority.indexOf(']')
            if (end < 0) return null
            val rest = authority.substring(end + 1)
            return when {
                rest.isEmpty() -> HostPort(authority.substring(0, end + 1), null)
                rest.startsWith(":") -> HostPort(authority.substring(0, end + 1), rest.substring(1))
                else -> null
            }
        }
        val colon = authority.lastIndexOf(':')
        if (colon < 0) return HostPort(authority, null)
        // Plusieurs ':' hors crochets = IPv6 non parenthésée : on refuse plutôt
        // que de deviner où passe le port.
        if (authority.substring(0, colon).contains(':')) return null
        return HostPort(authority.substring(0, colon), authority.substring(colon + 1))
    }

    private fun isValidPort(port: String): Boolean =
        port.length in 1..5 && port.all { it in '0'..'9' } && port.toInt() in 1..MAX_PORT

    private fun isValidHost(host: String): Boolean {
        val bare = if (host.startsWith("[") && host.endsWith("]")) {
            host.substring(1, host.length - 1)
        } else {
            host
        }
        if (bare.isEmpty() || bare.length > MAX_AUTHORITY_CHARS) return false
        if (bare.contains(':')) return isIpv6(bare)
        return isIpv4(bare) || isDnsName(bare)
    }

    // IPv4 littérale : 4 groupes 0-255. Zéro initial refusé (010 lu comme
    // octal par certains résolveurs et comme 10 par d'autres = deux hôtes).
    private fun isIpv4(host: String): Boolean {
        val groups = host.split('.')
        return groups.size == 4 && groups.all { g ->
            g.length in 1..3 && g.all { it in '0'..'9' } &&
                (g.length == 1 || g[0] != '0') && g.toInt() <= 255
        }
    }

    // IPv6 littérale : hexa et ':' seulement, au moins deux ':' (toute IPv6
    // valide en a deux ou plus). Pas d'identifiant de zone (`%iface`).
    private fun isIpv6(host: String): Boolean =
        host.count { it == ':' } >= 2 &&
            host.all { it in '0'..'9' || it in 'a'..'f' || it == ':' || it == '.' }

    // Nom DNS : étiquettes 1-63, alphanumériques et tirets, jamais de tiret en
    // tête ni en fin. Un seul label autorisé (poste ou réseau local).
    private fun isDnsName(host: String): Boolean {
        if (host.endsWith(".")) return false
        val labels = host.split('.')
        // RFC 1123 : le dernier label d'un nom de domaine ne peut pas être
        // entièrement numérique. Sinon « 010.0.0.1 » passerait pour un nom
        // alors que le résolveur le lit comme une IP à zéro initial (= autre
        // hôte) : on le refuse plutôt que de trancher à sa place.
        if (labels.size > 1 && labels.last().all { it in '0'..'9' }) return false
        return labels.all { label ->
            label.length in 1..MAX_LABEL_CHARS &&
                label.all { it in 'a'..'z' || it in '0'..'9' || it == '-' } &&
                !label.startsWith("-") && !label.endsWith("-")
        }
    }

    // #209 : le process serveur n'est plus qu'un scraper de manuels (plain
    // HTTPS, sans auth) ; #206 : l'app ne lui parle plus métier du tout (le
    // téléphone lit l'établissement en direct). `validateBaseUrl` ne valide
    // donc plus qu'une URL de scraper, et c'est la SEULE route connue ici.
    const val MANUALS_SCRAPE_PATH = "/v1/manuals/scrape"
    fun manualsScrapeUrl(baseUrl: String): String = baseUrl + MANUALS_SCRAPE_PATH

    // ponytail: allowlist = baseUrl + "/" (le préfixe nu laissait passer
    // `https://hote.evil.tld` quand baseUrl vaut `https://hote`, et baseUrl est
    // désormais une saisie utilisateur). Upgrade: pinning cert phase 10.
    fun isAllowed(url: String, baseUrl: String): Boolean =
        url == baseUrl || url.startsWith(baseUrl.trimEnd('/') + "/")
}

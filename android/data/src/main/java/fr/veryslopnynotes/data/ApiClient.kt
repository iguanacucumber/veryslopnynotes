package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ServerConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

// Un seul client HTTP de l'app : toutes les requêtes passent
// ici, vers la allowlist serveur seule. Refuse toute URL hors
// allowlist avant envoi. Médias via proxy serveur, pas de WebView.
// Contrat 0.5.0 : le serveur exige `Authorization: Bearer <token d'appareil>`
// sur TOUTES les routes sauf l'appairage, /v1/setup (la porte qui rend le
// secret) et /v1/health. Le secret est lu au
// moment de CONSTRUIRE la requête (jamais mémorisé ici : il change à
// l'appairage et à chaque ré-appairage). `tokens` null = pas encore appairé
// (previews/tests JVM) : la requête part sans header et le serveur refuse.
class ApiClient(
    baseUrl: String,
    client: OkHttpClient = OkHttpClient(),
    private val tokens: TokenStore? = null,
) {
    val baseUrl: String = baseUrl.trimEnd('/')
    // UN point d'observation des réponses pour toute l'app (#113) : repositories,
    // SSE et proxy média sortent tous par ce client, donc un 401 se décide ici et
    // nulle part ailleurs. `newBuilder()` partage le pool et le dispatcher du
    // client fourni (pas de second client, pas de DI).
    private val http: OkHttpClient = client.newBuilder()
        .addInterceptor(UnauthorizedGuard { isPublicPath(it) })
        .build()

    fun buildGet(path: String): Request = builder(path).get().build()

    fun buildPost(path: String, body: okhttp3.RequestBody): Request = builder(path).post(body).build()

    fun client(): OkHttpClient = http

    /**
     * URL allowlist + bearer éventuel. L'allowlist `ServerConfig.isAllowed`
     * reste le PREMIER filtre : le header d'authentification ne l'élargit
     * pas (une URL hors serveur reste refusée, token ou pas).
     */
    private fun builder(path: String): Request.Builder {
        val url = baseUrl + path
        require(ServerConfig.isAllowed(url, baseUrl)) { "URL hors allowlist serveur" }
        val builder = Request.Builder().url(url)
        // Route publique = aucun secret dans la requête (le serveur n'en
        // exige aucun, et un credential ne part pas « au cas où »).
        if (!isPublicPath(path)) {
            val token = tokens?.token()
            if (!token.isNullOrEmpty()) builder.header("Authorization", "Bearer $token")
        }
        return builder
    }

    companion object {
        // Miroir de `unauthorized` (server/api/errors.ts) : UN statut pour tout
        // refus de jeton, jamais un code par cause.
        const val HTTP_UNAUTHORIZED = 401

        // Miroir de `requireDevice` côté serveur : public = pas de jeton exigé.
        private val PUBLIC_PATHS = setOf(
            ServerConfig.PAIRING_START_PATH,
            ServerConfig.PAIRING_CONFIRM_PATH,
            ServerConfig.SETUP_PATH,
            ServerConfig.HEALTH_PATH,
        )

        /** La query ne change pas la route (`/v1/media?ref=…`). */
        private fun isPublicPath(path: String): Boolean = PUBLIC_PATHS.contains(path.substringBefore('?'))
    }
}

private const val HEADER_AUTHORIZATION = "Authorization"

/**
 * Garde-fou 401 (#113) : le SEUL endroit qui décide qu'une réponse invalide la
 * session appairée. Trois conditions, toutes nécessaires :
 * - statut 401 (le serveur ne dit pas pourquoi : inconnu / révoqué / expiré
 *   donnent le MÊME 401 « jeton d'appareil invalide », `errors.ts` + `router.ts`
 *   — donc l'app ne devine pas de cause, elle ré-appaire) ;
 * - route PROTÉGÉE : un 401 sur les routes d'appairage est un appairage refusé, pas une
 *   session perdue, sinon l'app se renverrait elle-même en boucle vers l'appairage ;
 * - un bearer RÉELLEMENT parti : sans jeton il n'y a rien à réparer. C'est la
 *   condition anti-boucle — après réparation (`AccountStore.logout()`) plus
 *   aucun `Authorization` ne part, donc plus aucun signal.
 * ponytail: interceptor applicatif, pas d'Authenticator/rechallenge OkHttp.
 */
private class UnauthorizedGuard(private val isPublic: (String) -> Boolean) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        if (response.code == ApiClient.HTTP_UNAUTHORIZED &&
            !isPublic(request.url.encodedPath) &&
            request.header(HEADER_AUTHORIZATION) != null
        ) {
            DeviceAuth.reject()
        }
        return response
    }
}

/**
 * Signal unique « credential d'appareil refusée » (#113), levé par
 * [UnauthorizedGuard] (thread réseau) et traité par l'UI qui invalide la session
 * via `AccountStore.logout()` puis renvoie à l'appairage.
 * ponytail: un seul listener, pas de bus d'événements. Upgrade: `StateFlow` si
 * plusieurs écrans doivent observer la session.
 */
object DeviceAuth {
    /**
     * UNE seule formulation pour tout refus de credential, parce qu'il n'y a
     * qu'un fait à dire : le serveur a refusé le jeton. Inconnu / révoqué /
     * expiré sont INDISTINGUABLES (`router.ts` : un seul 401 « jeton d'appareil
     * invalide »), donc l'app n'affiche ni cause devinée ni compte à rebours.
     */
    const val REJECTED_MESSAGE = "Credential d'appareil refusée : ré-appairez l'appareil."

    @Volatile
    private var onRejected: (() -> Unit)? = null

    /** Abonne l'UI ; `null` désabonne (écran détruit). */
    fun setOnRejected(listener: (() -> Unit)?) {
        onRejected = listener
    }

    /** Interne : seul le garde-fou lève le signal (jamais l'UI, jamais une piste). */
    internal fun reject() {
        onRejected?.invoke()
    }
}

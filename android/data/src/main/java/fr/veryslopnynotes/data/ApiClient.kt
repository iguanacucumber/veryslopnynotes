package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ServerConfig
import okhttp3.OkHttpClient
import okhttp3.Request

// Un seul client HTTP de l'app : toutes les requêtes passent
// ici, vers la allowlist serveur seule. Refuse toute URL hors
// allowlist avant envoi. Médias via proxy serveur, pas de WebView.
// Contrat 0.4.0 : le serveur exige `Authorization: Bearer <token d'appareil>`
// sur TOUTES les routes sauf l'appairage et /v1/health. Le secret est lu au
// moment de CONSTRUIRE la requête (jamais mémorisé ici : il change à
// l'appairage et à chaque ré-appairage). `tokens` null = pas encore appairé
// (previews/tests JVM) : la requête part sans header et le serveur refuse.
class ApiClient(
    baseUrl: String,
    client: OkHttpClient = OkHttpClient(),
    private val tokens: TokenStore? = null,
) {
    val baseUrl: String = baseUrl.trimEnd('/')
    private val http: OkHttpClient = client

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
        // Miroir de `requireDevice` côté serveur : public = pas de jeton exigé.
        private val PUBLIC_PATHS = setOf(
            ServerConfig.PAIRING_START_PATH,
            ServerConfig.PAIRING_CONFIRM_PATH,
            ServerConfig.HEALTH_PATH,
        )

        /** La query ne change pas la route (`/v1/media?ref=…`). */
        private fun isPublicPath(path: String): Boolean = PUBLIC_PATHS.contains(path.substringBefore('?'))
    }
}

package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ServerConfig
import okhttp3.OkHttpClient
import okhttp3.Request

// Un seul client HTTP de l'app : toutes les requêtes passent
// ici, vers la allowlist serveur seule. Refuse toute URL hors
// allowlist avant envoi. Médias via proxy serveur, pas de WebView.
class ApiClient(
    baseUrl: String,
    client: OkHttpClient = OkHttpClient(),
) {
    val baseUrl: String = baseUrl.trimEnd('/')
    private val http: OkHttpClient = client

    fun buildGet(path: String): Request {
        val url = baseUrl + path
        require(ServerConfig.isAllowed(url, baseUrl)) { "URL hors allowlist serveur" }
        return Request.Builder().url(url).get().build()
    }

    fun buildPost(path: String, body: okhttp3.RequestBody): Request {
        val url = baseUrl + path
        require(ServerConfig.isAllowed(url, baseUrl)) { "URL hors allowlist serveur" }
        return Request.Builder().url(url).post(body).build()
    }

    fun client(): OkHttpClient = http
}

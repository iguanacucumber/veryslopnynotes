package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.WebPageDoc
import fr.veryslopnynotes.core.WebUrl
import fr.veryslopnynotes.core.WebUrlResult
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// Page web confiée au scraper FACULTATIF, jamais à l'établissement ; même base
// allowlistée que le manuel, route distincte sans jar de session. L'URL ne
// revient JAMAIS dans la réponse (titre + texte seulement).
//
// Ni URL ni contenu journalisé : l'adresse peut révéler un établissement, le
// texte est une donnée externe (Untrusted avant IA).
class WebPagesClient(
    private val baseUrl: String,
    private val client: OkHttpClient = OkHttpClient(),
) {
    data class Fetch(val doc: WebPageDoc?, val error: String?)

    fun fetch(url: String): Fetch {
        val validated = WebUrl.validate(url)
        if (validated !is WebUrlResult.Ok) {
            return Fetch(null, (validated as WebUrlResult.Rejected).message)
        }
        if (!baseUrl.contains("://")) {
            return Fetch(null, "Scraper non configuré : renseigne son adresse dans Réglages.")
        }
        val payload = JSONObject().put("url", validated.url).toString()
        val request = Request.Builder()
            .url(ServerConfig.webScrapeUrl(baseUrl))
            .post(payload.toRequestBody(JSON))
            .build()
        val http = client.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .readTimeout(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .callTimeout(CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val body = response.peekBody(MAX_ERROR_BYTES).string()
                    return Fetch(null, messageFor(response.code, errorCode(body)))
                }
                parse(response.peekBody(MAX_BODY_BYTES).string())
            }
        } catch (_: Exception) {
            // Jamais l'exception brute : elle peut nommer l'hôte du scraper.
            Fetch(null, "Scraper injoignable : vérifie son adresse dans Réglages.")
        }
    }

    private fun parse(body: String): Fetch {
        val docs = try {
            JSONObject(body).optJSONArray("docs")
        } catch (_: Exception) {
            null
        } ?: return Fetch(null, "Réponse du scraper illisible.")
        for (i in 0 until docs.length()) {
            val item = docs.optJSONObject(i) ?: continue
            val doc = WebPageDoc(
                title = item.optString("title").trim(),
                excerpt = item.optString("excerpt").trim(),
            )
            if (doc.isValid()) return Fetch(doc, null)
        }
        return Fetch(null, "Aucun texte lisible sur cette page.")
    }

    private fun errorCode(body: String): String? = try {
        JSONObject(body).optJSONObject("error")?.optString("code")?.takeIf { it.isNotBlank() }
    } catch (_: Exception) {
        null
    }

    companion object {
        const val CONNECT_TIMEOUT_MS = 5_000L
        const val READ_TIMEOUT_MS = 32_000L
        const val CALL_TIMEOUT_MS = 35_000L
        const val MAX_BODY_BYTES = 256L * 1024L
        const val MAX_ERROR_BYTES = 4L * 1024L

        private val JSON = "application/json; charset=utf-8".toMediaType()

        fun messageFor(status: Int, code: String? = null): String = when (code) {
            "private_host" -> "Adresse privée refusée par le scraper."
            "unresolved_host" -> "Nom d'hôte introuvable : vérifie l'adresse de la page."
            "timeout" -> "Le scraper a dépassé le délai : réessaie."
            "too_large" -> "Page trop volumineuse pour être citée."
            "not_text" -> "Cette page n'est pas du texte (PDF, image ou binaire)."
            "not_implemented" -> "Le scraper n'a pas de navigateur disponible."
            else -> when (status) {
                400 -> "Adresse refusée par le scraper."
                403 -> "Adresse privée refusée par le scraper."
                404 -> "Scraper introuvable : vérifie son adresse dans Réglages."
                413 -> "Page trop volumineuse pour être citée."
                415 -> "Cette page n'est pas du texte (PDF, image ou binaire)."
                501 -> "Le scraper n'a pas de navigateur disponible."
                502 -> "Le scraper n'a pas pu lire cette page."
                504 -> "Le scraper a dépassé le délai : réessaie."
                else -> "Le scraper a refusé la page (HTTP $status)."
            }
        }
    }
}

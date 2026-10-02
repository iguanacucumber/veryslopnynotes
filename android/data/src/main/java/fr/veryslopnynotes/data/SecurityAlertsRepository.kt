package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.core.ServerConfig
import org.json.JSONArray
import org.json.JSONObject

// Dépôt alertes sécurité (#21) : GET /v1/security/alerts via ApiClient
// allowlist seule (I1). Parse org.json (SDK, sans nouvelle dépendance).
// Excerpt gardé comme donnée brute, jamais interprété (I6 : pas de
// WebView/Html ici ni côté ui).
class SecurityAlertsRepository(
    private val api: ApiClient,
) {
    fun request(): okhttp3.Request =
        api.buildGet("/v1/security/alerts")

    fun fetch(): List<SecurityAlert> {
        val call = api.client().newCall(request())
        call.execute().use { res ->
            require(res.isSuccessful) { "alertes HTTP ${res.code}" }
            val body = res.body?.string().orEmpty()
            return parse(body)
        }
    }

    companion object {
        // ponytail: parse manuel org.json, pas de serializer. Upgrade: kotlinx.serialization si modèles > 10.
        fun parse(body: String): List<SecurityAlert> {
            val root = JSONObject(body)
            val arr: JSONArray = root.optJSONArray("alerts") ?: JSONArray()
            val out = mutableListOf<SecurityAlert>()
            for (i in 0 until arr.length()) {
                val o: JSONObject = arr.optJSONObject(i) ?: continue
                val alert = SecurityAlert(
                    id = o.optString("id", ""),
                    kind = o.optString("kind", ""),
                    excerpt = o.optString("excerpt", ""),
                    source = o.optString("source", ""),
                )
                if (SecurityAlert.isValid(alert)) out.add(alert)
            }
            return out
        }

        fun url(baseUrl: String): String = ServerConfig.securityAlertsUrl(baseUrl)
    }
}

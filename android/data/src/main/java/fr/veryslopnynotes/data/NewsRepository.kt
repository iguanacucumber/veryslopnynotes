package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.NewsItem
import fr.veryslopnynotes.core.ServerConfig
import org.json.JSONArray
import org.json.JSONObject

// Dépôt actualités établissement #79 : GET /v1/news via ApiClient allowlist
// seule (I1). Parse org.json (SDK, sans dépendance), items non conformes
// rejetés (isValid) = jamais de 500 ni d'affichage d'un actu cassée.
// Corps = donnée affichée, jamais interprété (I6 : pas de WebView/Html).
class NewsRepository(
    private val api: ApiClient,
) {
    fun request(): okhttp3.Request = api.buildGet(PATH)

    fun fetch(): List<NewsItem> {
        val call = api.client().newCall(request())
        call.execute().use { res ->
            require(res.isSuccessful) { "actualités HTTP ${res.code}" }
            return parse(res.body?.string().orEmpty())
        }
    }

    companion object {
        const val PATH = "/v1/news"

        // ponytail: parse manuel org.json, pas de serializer. Upgrade: kotlinx.serialization si modèles > 10.
        fun parse(body: String): List<NewsItem> {
            val root = JSONObject(body)
            val arr: JSONArray = root.optJSONArray("news") ?: JSONArray()
            val out = mutableListOf<NewsItem>()
            for (i in 0 until arr.length()) {
                val o: JSONObject = arr.optJSONObject(i) ?: continue
                // read absent = false (affichage) : le contrat porte "inconnu" = absent.
                val item = NewsItem(
                    id = o.optString("id", ""),
                    title = o.optString("title", ""),
                    body = o.optString("body", ""),
                    publishedAt = o.optString("publishedAt", ""),
                    category = o.optString("category", ""),
                    author = o.optString("author", ""),
                    read = o.optBoolean("read", false),
                )
                if (NewsItem.isValid(item)) out.add(item)
            }
            return out
        }

        fun url(baseUrl: String): String = ServerConfig.newsUrl(baseUrl)
    }
}

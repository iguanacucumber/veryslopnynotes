package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import org.json.JSONArray
import org.json.JSONObject

// Actualités : payload `news`.

internal fun newsPayload(client: Client): String {
    val arr = JSONArray()
    val raws = client.informationAndSurveys()
    raws.take(100).forEachIndexed { i, info ->
        // #475 : la LISTE ne télécharge plus le corps (1 POST, pas 21) : le
        // corps est une DONNÉE demandée à la demande, au dépliage
        // (`news.item` -> `Client.informationContent(id)`).
        val title = boundedCp(info.title, 200)
        val finalTitle = title.ifEmpty { "Actualité" }
        arr.put(JSONObject().apply {
            put("id", info.id.ifBlank { "news-$i" })
            put("title", finalTitle)
            put("publishedAt", (info.creationDate ?: info.startDate)?.parisIso() ?: parisNowIso())
            putIf("category", boundedCp(info.category, 100).ifEmpty { null })
            putIf("author", boundedCp(info.author, 100).ifEmpty { null })
            put("read", info.read)
        })
    }
    return JSONObject().put("news", arr).toString()
}


package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

@Serializable
private data class NewsEntry(
    val id: String,
    val title: String,
    val publishedAt: String,
    val category: String? = null,
    val author: String? = null,
    val read: Boolean,
)

@Serializable
private data class NewsPayload(
    val news: List<NewsEntry>,
    val partial: Boolean = false,
)

internal fun newsPayload(client: Client): String {
    val read = client.informationAndSurveysPartial()
    val news = read.value.take(100).mapIndexed { i, info ->
        // La LISTE ne télécharge pas le corps (1 POST, pas 21) : il est demandé
        // au dépliage (`news.item` -> `Client.informationContent(id)`).
        NewsEntry(
            id = info.id.ifBlank { "news-$i" },
            title = boundedCp(info.title, 200).ifEmpty { "Actualité" },
            publishedAt = (info.creationDate ?: info.startDate)?.parisIso() ?: parisNowIso(),
            category = boundedCp(info.category, 100).ifEmpty { null },
            author = boundedCp(info.author, 100).ifEmpty { null },
            read = info.read,
        )
    }
    return payloadJson.encodeToString(NewsPayload(news, read.partial))
}

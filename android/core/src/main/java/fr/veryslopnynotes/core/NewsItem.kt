package fr.veryslopnynotes.core

// Actualité établissement : miroir de shared/contracts/models.ts NewsItem.
// Titre/corps = DONNÉE de l'établissement, affichée par Text() seul (I6).
// ponytail: pas de lib date — l'UI lit et affiche l'horodatage.
data class NewsItem(
    val id: String,
    val title: String,
    val body: String,
    val publishedAt: String,
    val category: String,
    val author: String,
    val read: Boolean,
) {
    companion object {
        const val MAX_TITLE = 200
        const val MAX_BODY = 2000
        const val MAX_META = 100

        fun isValid(item: NewsItem): Boolean {
            if (item.id.isBlank()) return false
            val title = item.title.trim()
            if (title.isEmpty() || title.length > MAX_TITLE) return false
            if (item.body.length > MAX_BODY) return false
            if (item.category.length > MAX_META) return false
            if (item.author.length > MAX_META) return false
            return true
        }

        fun readLabel(item: NewsItem): String = if (item.read) "Lu" else "Non lu"
    }
}
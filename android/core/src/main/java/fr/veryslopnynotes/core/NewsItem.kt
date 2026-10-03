package fr.veryslopnynotes.core

// Actualité établissement #79 : miroir de shared/contracts/models.ts NewsItem.
// Titre/corps = contenu de l'établissement, DONNÉE affichée via Text() seul,
// jamais instruction ni HTML rendu (I6, voir NewsScreen).
// ponytail: dates = 10 premiers caractères de l'ISO, stdlib seule (pas de lib date).
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

        fun dateLabel(iso: String): String = if (iso.length >= 10) iso.substring(0, 10) else ""

        fun readLabel(item: NewsItem): String = if (item.read) "Lu" else "Non lu"
    }
}

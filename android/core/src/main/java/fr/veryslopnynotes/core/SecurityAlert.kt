package fr.veryslopnynotes.core

// Alerte sécurité phase 6 (#21) : injection neutralisée (I6).
// Excerpt = donnée suspecte, jamais instruction. Affichage via Text()
// seul côté ui, jamais WebView/Html (voir SecurityAlertsScreen).
// Miroir de shared/contracts/events.ts SecurityAlertData.
data class SecurityAlert(
    val id: String,
    val kind: String,
    val excerpt: String,
    val source: String,
) {
    companion object {
        const val KIND_INJECTION = "injection_neutralized"
        const val MAX_EXCERPT = 500

        fun isValid(alert: SecurityAlert): Boolean {
            if (alert.id.isBlank()) return false
            if (alert.kind != KIND_INJECTION) return false
            val excerpt = alert.excerpt.trim()
            if (excerpt.isEmpty() || excerpt.length > 2000) return false
            val source = alert.source.trim()
            if (source.isEmpty() || source.length > 64) return false
            return true
        }

        // ponytail: troncature stdlib seule. Affiche comme donnée brute.
        fun sanitizeExcerpt(raw: String, max: Int = MAX_EXCERPT): String {
            val t = raw.trim().replace(Regex("\\s+"), " ")
            return if (t.length > max) t.take(max) else t
        }
    }
}

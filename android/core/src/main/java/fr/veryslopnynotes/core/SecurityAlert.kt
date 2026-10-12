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
    /** Un texte local à scanner : `source` = origine pipeline (homework, news…). */
    data class ScannableText(val source: String, val text: String)

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

        // Marques d'injection cherchées dans les textes locaux (I6 sur
        // l'appareil, #205) : les mêmes attaques que les fixtures serveur
        // (`SEED_ALERTS`, tests/security) — une donnée qui ordonne d'ignorer
        // les consignes, jamais une instruction suivie.
        private val INJECTION_MARKS = listOf(
            "ignore les instructions",
            "oublie tout",
            "nouvelle instruction",
            "consigne système",
            "consigne systeme",
            "untrusted",
        )

        /**
         * Balayage local des textes déjà lus (cache) : un texte qui porte une
         * marque d'injection devient une alerte `injection_neutralized` (extrait
         * assaini, jamais le texte brut). Pur, déterministe, sans réseau : un
         * scan frais sans marque = « vérifié, rien trouvé » (ALL_CLEAR honnête),
         * pas une absence de vérification.
         */
        fun scanTextsForInjections(texts: List<ScannableText>): List<SecurityAlert> {
            val out = mutableListOf<SecurityAlert>()
            var seq = 0
            for (item in texts) {
                val source = item.source.trim().take(64)
                if (source.isEmpty()) continue
                val lowered = item.text.lowercase()
                if (INJECTION_MARKS.none { it in lowered }) continue
                seq += 1
                val alert = SecurityAlert(
                    id = "local-$source-$seq",
                    kind = KIND_INJECTION,
                    excerpt = sanitizeExcerpt(item.text),
                    source = source,
                )
                if (isValid(alert)) out.add(alert)
            }
            return out
        }
    }
}

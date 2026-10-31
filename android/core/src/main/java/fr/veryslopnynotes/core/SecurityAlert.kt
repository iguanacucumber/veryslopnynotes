package fr.veryslopnynotes.core

import java.text.Normalizer
import java.util.Base64

// Alerte sécurité : injection neutralisée (I6). Excerpt = donnée suspecte,
// jamais instruction. Affichage via Text() seul, jamais WebView/Html.
// Miroir de shared/contracts/events.ts SecurityAlertData.
data class SecurityAlert(
    val id: String,
    val kind: String,
    val excerpt: String,
    val source: String,
) {
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

        // Filtre anti-injection : HEURISTIQUE, pas un vérificateur. Il reconnaît
        // des FORMULATIONS d'injection courantes (français, anglais) après
        // normalisation. Il ne prouve NI l'absence d'injection (paraphrase,
        // encodage, autre langue passent) NI l'absence de contenu légitime.
        //
        // Un mot isolé ne suffit pas : il faut une FORMULE (un verbe d'override
        // suivi d'un nom de consigne, ou une formule d'override autonome).
        //
        // LIMITES assumées : une paraphrase passe ; la forme élidée « ignore
        // l'instruction… » n'est PAS retenue (notes de cours légitimes) ; une
        // note qui PARLE d'override peut être signalée à tort.

        /** Caractères invisibles : zero-width, BOM, tiret conditionnel. */
        private val INVISIBLE_RE = Regex("[\u00AD\u180E\u200B\u200C\u200D\u2060\uFEFF]")

        /** Espaces ASCII et Unicode : repliés en un seul espace. */
        private val SPACES_RE = Regex("[\\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+")

        /** Diacritiques latins (NFD) : « système » et « systeme » = même texte. */
        private val COMBINING_RE = Regex("[\u0300-\u036F]")

        /**
         * Formulations d'injection reconnues ; les mots de liaison sont facultatifs.
         */
        private val INJECTION_PATTERNS: List<Regex> = listOf(
            Regex("""ignore\w*\s+(?:toutes?\s+)?(?:(?:les?|la|ces?|tes?|ta|vos?|cette)\s+)?(?:consignes?|instructions?)"""),
            Regex("""ignore\w*\s+tout\s+ce\s+qui\s+precede"""),
            Regex("""oublie\w*\s+(?:tout\b|(?:(?:toutes?\s+les\s+|les\s+|la\s+|ce\s+|ces\s+|cette\s+)?(?:consignes?|instructions?)))"""),
            Regex("""nouvelle\s+instruction"""),
            Regex("""(?:ignore|disregard|forget)\s+(?:(?:all|any|the|my|your|these|those|of|about)\s+)*(?:(?:previous|prior|earlier|above|preceding|foregoing|former)\s+)*(?:instructions?|directives?|rules?|guidelines?|everything|above)"""),
            // L'article est EXIGÉ : « prompt engineering » n'est pas une consigne.
            Regex("""(?:ignore|disregard|forget)\s+(?:(?:all|any|the|my|your|these|those|of|about)\s+)*(?:(?:previous|prior|earlier|above|preceding|foregoing|former)\s+)*(?:the|this|that|system)\s+prompts?\b"""),
        )

        /** Candidats base64 : une charge encodée reste une injection. */
        private val BASE64_RE = Regex("[A-Za-z0-9+/]{24,}={0,2}")

        // ponytail: 16 candidats suffisent (une note porte rarement plus de
        // charges encodées) ; au-delà, le scan reste borné.
        private const val MAX_ENCODED_CANDIDATES = 16

        /**
         * Balayage local des textes déjà lus : un texte qui porte une formule
         * d'injection devient une alerte (extrait assaini, jamais le texte brut).
         */
        fun scanTextsForInjections(texts: List<ScannableText>): List<SecurityAlert> {
            val out = mutableListOf<SecurityAlert>()
            var seq = 0
            for (item in texts) {
                val source = item.source.trim().take(64)
                if (source.isEmpty()) continue
                if (!matchesInjection(item.text)) continue
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

        private fun matchesInjection(raw: String): Boolean {
            val folded = fold(raw)
            val text = foldAccents(folded.lowercase())
            if (INJECTION_PATTERNS.any { it.containsMatchIn(text) }) return true
            // Une charge encodée est relue comme du texte : elle n'est pas inoffensive.
            var seen = 0
            for (candidate in BASE64_RE.findAll(folded)) {
                if (seen >= MAX_ENCODED_CANDIDATES) break
                seen += 1
                val decoded = decodeBase64(candidate.value) ?: continue
                if (decoded.isBlank()) continue
                if (INJECTION_PATTERNS.any { it.containsMatchIn(comparable(decoded)) }) return true
            }
            return false
        }

        /** Forme comparée : NFKC, invisibles retirés, espaces repliés, minuscules. */
        private fun fold(raw: String): String {
            val nfkc = Normalizer.normalize(raw, Normalizer.Form.NFKC)
            return SPACES_RE.replace(INVISIBLE_RE.replace(nfkc, ""), " ").trim()
        }

        private fun foldAccents(text: String): String =
            COMBINING_RE.replace(Normalizer.normalize(text, Normalizer.Form.NFD), "")

        private fun comparable(raw: String): String = foldAccents(fold(raw).lowercase())

        private fun decodeBase64(candidate: String): String? = try {
            String(Base64.getDecoder().decode(candidate), Charsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}

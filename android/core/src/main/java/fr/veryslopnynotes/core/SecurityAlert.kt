package fr.veryslopnynotes.core

import java.text.Normalizer
import java.util.Base64

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

        // --- Filtre anti-injection (#415) -----------------------------------
        //
        // HEURISTIQUE, pas un vérificateur. Le filtre reconnaît des
        // FORMULATIONS d'injection courantes (français, anglais) après
        // normalisation. Il ne prouve NI l'absence d'injection (une paraphrase,
        // un encodage, une autre langue passent) NI l'absence de contenu
        // légitime (une note qui PARLE d'injection peut être signalée).
        // L'interface le dit : « heuristique », jamais « vérifié ».
        //
        // #415 corrige trois défauts de la version précédente (liste de
        // sous-chaînes littérales, sans normalisation) :
        //  1. contournable : casse, espaces multiples, accents, caractères
        //     zero-width et charges encodées passaient sans alerte ;
        //  2. trop bavard : des marqueurs ISOLÉS (une formule HTTP, un mot
        //     technique de l'app) déclenchaient une alerte rouge sur une note
        //     de cours parfaitement légitime ;
        //  3. l'interface annonçait un contrôle (« vérifié ») au lieu d'une
        //     heuristique.
        //
        // Un mot isolé ne suffit plus : il faut une FORMULE (un verbe
        // d'override suivi d'un nom de consigne, ou une formule d'override
        // autonome). C'est ce qui sépare « la consigne système d'un serveur »
        // (légitime) de « ignore la consigne système » (injection).

        /** Caractères invisibles : zero-width, BOM, tiret conditionnel. */
        private val INVISIBLE_RE = Regex("[\u00AD\u180E\u200B\u200C\u200D\u2060\uFEFF]")

        /** Espaces ASCII et Unicode : repliés en un seul espace. */
        private val SPACES_RE = Regex("[\\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+")

        /** Diacritiques latins (NFD) : « système » et « systeme » = même texte. */
        private val COMBINING_RE = Regex("[\u0300-\u036F]")

        /**
         * Formulations d'injection reconnues. Les mots de liaison sont
         * facultatifs (correspondance tolérante) : « ignore les instructions »,
         * « ignorez les consignes précédentes », « ignore previous
         * instructions », « Disregard the above »…
         */
        private val INJECTION_PATTERNS: List<Regex> = listOf(
            // FR — « ignore(ez) les consignes|instructions »
            Regex("""ignore\w*\s+(?:toutes?\s+)?(?:(?:les?|la|ces?|tes?|ta|vos?)\s+)?(?:consignes?|instructions?)"""),
            // FR — « oublie(ez) tout » / « oublie les instructions »
            Regex("""oublie\w*\s+(?:tout\b|(?:(?:toutes?\s+les\s+|les\s+|la\s+|ce\s+|ces\s+)?(?:consignes?|instructions?)))"""),
            // FR — « nouvelle instruction » (formule d'override)
            Regex("""nouvelle\s+instruction"""),
            // EN — « ignore (all) (previous) instructions »
            Regex("""ignore\s+(?:(?:all|any|the|my|your|these|those)\s+)*(?:(?:previous|prior|earlier|above|preceding|foregoing|former)\s+)*(?:instructions?|directives?|rules?|guidelines?)"""),
            // EN — « ignore the prompt » : l'article est EXIGÉ, « prompt
            // engineering » n'est pas une consigne.
            Regex("""ignore\s+(?:(?:all|any|the|my|your|these|those)\s+)*(?:(?:previous|prior|earlier|above|preceding|foregoing|former)\s+)*(?:the|this|that|system)\s+prompts?\b"""),
            // EN — « disregard the above »
            Regex("""disregard\s+(?:(?:all|any|the|these|those|of)\s+)*(?:above|previous|preceding|prior|earlier|foregoing|former|everything)\b"""),
            // EN — « forget everything » / « forget all previous instructions »
            Regex("""forget\s+(?:everything|all\s+(?:the\s+)?(?:(?:previous|prior|earlier|above)\s+)*instructions?|previous\s+instructions?|about\s+everything)"""),
        )

        /** Candidats base64 : une charge encodée reste une injection. */
        private val BASE64_RE = Regex("[A-Za-z0-9+/]{24,}={0,2}")

        // ponytail: 16 candidats suffisent (une note porte rarement plus de
        // charges encodées) ; au-delà, le scan reste borné.
        private const val MAX_ENCODED_CANDIDATES = 16

        /**
         * Balayage local des textes déjà lus (cache) : un texte qui porte une
         * formule d'injection devient une alerte `injection_neutralized`
         * (extrait assaini, jamais le texte brut). Pur, déterministe, sans
         * réseau : un scan frais sans formule = « heuristique, rien trouvé »,
         * pas une absence de vérification.
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

        /** Une formulation d'injection est-elle présente dans le texte ? */
        private fun matchesInjection(raw: String): Boolean {
            val folded = fold(raw)
            val text = foldAccents(folded.lowercase())
            if (INJECTION_PATTERNS.any { it.containsMatchIn(text) }) return true
            // Une charge encodée est relue comme du texte : encodée, elle
            // n'est pas plus inoffensive (#415).
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

        /** Accents pliés : « système » et « systeme » deviennent le même texte. */
        private fun foldAccents(text: String): String =
            COMBINING_RE.replace(Normalizer.normalize(text, Normalizer.Form.NFD), "")

        /** Texte prêt à comparer : plié, minuscules, accents pliés. */
        private fun comparable(raw: String): String = foldAccents(fold(raw).lowercase())

        /** Décodage base64 (stdlib) : `null` si le candidat n'est pas du base64. */
        private fun decodeBase64(candidate: String): String? = try {
            String(Base64.getDecoder().decode(candidate), Charsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}

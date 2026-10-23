package fr.veryslopnynotes.core

import java.text.Normalizer
import java.util.Locale

// Choix du manuel lelivrescolaire.fr à partir de ce que l'app sait déjà :
// - la classe vient du profil Pronote (`classLabel`, ex. « TG2 ») ;
// - les spécialités sont déduites des matières réellement suivies
//   (notes, devoirs, emploi du temps), jamais inventées ;
// - la matière du devoir choisit l'ouvrage dans une petite table de slugs
//   VÉRIFIÉS. Une matière absente de la table (NSI, HGGSP, SVT en Tle…)
//   n'ouvre AUCUN manuel : mieux vaut pas de source qu'un mauvais ouvrage.
//
// L'app ne contacte pas le site : elle construit une adresse que le scraper
// facultatif lira. Le domaine n'est pas en dur ici (I1) : l'adresse de base
// est celle saisie par l'utilisateur (par défaut `/manuels`), et seuls les
// slugs — des noms de collections, pas des hôtes — sont dans cette table.
enum class ManualLevel {
    SIXIEME, CINQUIEME, QUATRIEME, TROISIEME, SECONDE, PREMIERE, TERMINALE, UNKNOWN,
}

object ManualCatalog {
    private val SLUGS: Map<ManualLevel, Map<String, String>> = mapOf(
        ManualLevel.SIXIEME to mapOf(
            "MATH" to "mathematiques-6eme-2025",
            "FR" to "francais-6eme-2025",
            "HG" to "histoire-geographie-emc-6eme-2022",
            "ANG" to "anglais-6eme-2025",
            "SCIENCES" to "sciences-et-technologie-6e-2024",
        ),
        ManualLevel.CINQUIEME to mapOf(
            "MATH" to "mathematiques-5eme-2026",
            "FR" to "francais-5eme-2026",
            "HG" to "histoire-geographie-emc-5eme-2016",
            "ANG" to "anglais-5eme-2026",
            "ESP" to "espagnol-5eme-2026",
            "PC" to "physique-chimie-5eme-2017",
            "SVT" to "sciences-de-la-vie-et-de-la-terre-5eme-2017",
        ),
        ManualLevel.QUATRIEME to mapOf(
            "MATH" to "mathematiques-4eme-2022",
            "FR" to "francais-4eme-2022",
            "HG" to "histoire-geographie-emc-4eme-2016",
            "ANG" to "anglais-4eme-2017",
            "ESP" to "espagnol-4eme-2017",
            "PC" to "physique-chimie-4eme-2017",
            "SVT" to "sciences-de-la-vie-et-de-la-terre-4eme-2017",
        ),
        ManualLevel.TROISIEME to mapOf(
            "MATH" to "mathematiques-3eme-2021",
            "FR" to "francais-3eme-2021",
            "HG" to "histoire-geographie-emc-3eme-2021",
            "ANG" to "anglais-3eme-2017",
            "ESP" to "espagnol-3eme-2017",
            "PC" to "physique-chimie-3eme-2017",
            "SVT" to "sciences-de-la-vie-et-de-la-terre-3eme-2017",
        ),
        ManualLevel.SECONDE to mapOf(
            "MATH" to "mathematiques-2de-2019",
            "PC" to "physique-chimie-2de-2019",
            "SVT" to "sciences-de-la-vie-et-de-la-terre-2de-2019",
            "SES" to "sciences-economiques-et-sociales-2de-2022",
            "HG" to "histoire-geographie-emc-2de-2019",
            "FR" to "francais-2de-2019",
            "ANG" to "anglais-2de-2025",
            "ESP" to "espagnol-2de-2025",
            "SNT" to "sciences-numeriques-et-technologie-2de-2021",
        ),
        ManualLevel.PREMIERE to mapOf(
            "MATH" to "mathematiques-1re-2019",
            "PC" to "physique-chimie-1re-2019",
            "SES" to "sciences-economiques-et-sociales-1re-2019",
            "HG" to "histoire-geographie-emc-1re-2019",
            "FR" to "francais-1re-2021",
            "ANG" to "anglais-1re-2026",
            "ESP" to "espagnol-1re-2026",
            "ES" to "enseignement-scientifique-1re-2023",
        ),
        ManualLevel.TERMINALE to mapOf(
            "MATH" to "mathematiques-specialite-terminale-2020",
            "MATH_EXP" to "mathematiques-experte-terminale-2020",
            "PC" to "physique-chimie-terminale-2020",
            "HG" to "histoire-geographie-emc-terminale-2020",
            "PHILO" to "philosophie-terminale-2020",
            "ANG" to "anglais-terminale-2026",
            "ESP" to "espagnol-terminale-2020",
            "ES" to "enseignement-scientifique-tle-2023",
        ),
    )

    private val SPECIALTY_LABELS = mapOf(
        "MATH" to "Mathématiques",
        "MATH_EXP" to "Mathématiques expertes",
        "PC" to "Physique-Chimie",
        "SVT" to "SVT",
        "SES" to "SES",
        "HGGSP" to "HGGSP",
        "NSI" to "NSI",
        "LLCE_ANG" to "LLCE Anglais",
        "LLCE_ESP" to "LLCE Espagnol",
    )
    private val SPECIALTY_KEYS_1RE = setOf("MATH", "PC", "SVT", "SES", "HGGSP", "NSI", "LLCE_ANG", "LLCE_ESP")
    private val SPECIALTY_KEYS_TLE = SPECIALTY_KEYS_1RE + "MATH_EXP"

    /**
     * Une adresse de CATALOGUE (pas un manuel précis) : l'app doit alors
     * résoudre l'ouvrage selon la classe et la matière. Le chemin seul décide,
     * jamais le domaine.
     */
    fun isCatalog(raw: String): Boolean {
        val path = pathOf(raw) ?: return false
        return path == "/manuels" || path == "/tous-les-manuels"
    }

    /** Niveau deviné depuis le libellé de classe, sinon depuis les matières. */
    fun levelOf(classLabel: String, subjects: List<String>): ManualLevel {
        val text = words(classLabel)
        if (text.isNotEmpty()) {
            // Voies professionnelle / technologique : la table ne couvre que
            // les manuels généraux. Aucun ouvrage plutôt qu'un mauvais.
            // « générale et technologique » est le lycée GÉNÉRAL : ne pas le
            // confondre avec une série technologique.
            val generalTrack = text.contains("GENERALE ET TECHNOLOGIQUE") ||
                text.contains("GENERAL ET TECHNOLOGIQUE")
            if (text.contains("BAC PRO") || text.contains("BTS") || text.contains("CAP") ||
                (!generalTrack && (text.contains("TECHNOLOGIQUE") || text.contains("TECHNO"))) ||
                text.contains("STMG") || text.contains("STI2D") || text.contains("ST2S") ||
                text.contains("STL") || text.contains("STD2A") || text.contains("STHR") ||
                text.contains("S2TMD")
            ) return ManualLevel.UNKNOWN
            if (text == "2GT" || text.startsWith("2GT ")) return ManualLevel.SECONDE
            if (text == "1GT" || text.startsWith("1GT ")) return ManualLevel.PREMIERE
            if (text == "TGT" || text.startsWith("TGT ")) return ManualLevel.TERMINALE
            if (text.contains("TERMINALE") || Regex("\\bTLE\\b").containsMatchIn(text) ||
                Regex("^T[A-Z]*\\d").containsMatchIn(text)
            ) return ManualLevel.TERMINALE
            if (text.contains("PREMIERE") || Regex("\\b1RE\\b").containsMatchIn(text) ||
                Regex("\\b1ERE\\b").containsMatchIn(text) || Regex("^1[A-Z]*\\d").containsMatchIn(text)
            ) return ManualLevel.PREMIERE
            if (text.contains("SECONDE") || Regex("\\b2DE\\b").containsMatchIn(text) ||
                Regex("\\b2NDE\\b").containsMatchIn(text) || Regex("^2[A-Z]*\\d").containsMatchIn(text)
            ) return ManualLevel.SECONDE
            if (text.contains("TROISIEME") || Regex("\\b3E\\b").containsMatchIn(text) ||
                Regex("\\b3EME\\b").containsMatchIn(text)
            ) return ManualLevel.TROISIEME
            if (text.contains("QUATRIEME") || Regex("\\b4E\\b").containsMatchIn(text) ||
                Regex("\\b4EME\\b").containsMatchIn(text)
            ) return ManualLevel.QUATRIEME
            if (text.contains("CINQUIEME") || Regex("\\b5E\\b").containsMatchIn(text) ||
                Regex("\\b5EME\\b").containsMatchIn(text)
            ) return ManualLevel.CINQUIEME
            if (text.contains("SIXIEME") || Regex("\\b6E\\b").containsMatchIn(text) ||
                Regex("\\b6EME\\b").containsMatchIn(text)
            ) return ManualLevel.SIXIEME
        }
        // Pas de classe lisible : les matières donnent un indice PRUDENT.
        val keys = subjects.mapNotNull { subjectKey(it) }.toSet()
        return when {
            "SNT" in keys -> ManualLevel.SECONDE
            "PHILO" in keys -> ManualLevel.TERMINALE
            "ES" in keys && "FR" in keys -> ManualLevel.PREMIERE
            else -> ManualLevel.UNKNOWN
        }
    }

    fun levelLabel(level: ManualLevel): String = when (level) {
        ManualLevel.SIXIEME -> "6e"
        ManualLevel.CINQUIEME -> "5e"
        ManualLevel.QUATRIEME -> "4e"
        ManualLevel.TROISIEME -> "3e"
        ManualLevel.SECONDE -> "2de"
        ManualLevel.PREMIERE -> "1re"
        ManualLevel.TERMINALE -> "Terminale"
        ManualLevel.UNKNOWN -> ""
    }

    /** Spécialités probables, dans l'ordre des matières suivies. */
    fun specialties(classLabel: String, subjects: List<String>): List<String> {
        val level = levelOf(classLabel, subjects)
        val allowed = when (level) {
            ManualLevel.PREMIERE -> SPECIALTY_KEYS_1RE
            ManualLevel.TERMINALE -> SPECIALTY_KEYS_TLE
            else -> emptySet()
        }
        return subjects.mapNotNull { subjectKey(it) }
            .filter { it in allowed }
            .mapNotNull { SPECIALTY_LABELS[it] }
            .distinct()
    }

    /**
     * Adresse du manuel pour `subject`, ou null quand l'ouvrage n'existe pas
     * dans la table. `baseUrl` doit être une adresse de catalogue.
     */
    fun resolve(baseUrl: String, classLabel: String, subjects: List<String>, subject: String): String? {
        if (!isCatalog(baseUrl)) return null
        val level = levelOf(classLabel, subjects)
        val key = subjectKey(subject) ?: return null
        val slug = SLUGS[level]?.get(key) ?: return null
        return manualUrl(baseUrl, slug)
    }

    /** Clé de matière, tolérante aux libellés Pronote (accents, casse, « MATHS »). */
    fun subjectKey(raw: String): String? {
        val s = words(raw)
        if (s.isEmpty()) return null
        return when {
            s.contains("MATHEMATIQUES EXPERTES") || s.contains("MATHS EXPERTES") -> "MATH_EXP"
            s.contains("MATHEMATIQUES") || s == "MATHS" || s.startsWith("MATH ") -> "MATH"
            s.contains("PHYSIQUE") && s.contains("CHIMIE") -> "PC"
            s.contains("SCIENCES DE LA VIE") || s.contains("SVT") -> "SVT"
            s.contains("SCIENCES ECONOMIQUES") || s.contains("SES") -> "SES"
            s.contains("GEOPOLITIQUE") || s.contains("HGGSP") -> "HGGSP"
            s.contains("LLCE") && s.contains("ANGLAIS") -> "LLCE_ANG"
            s.contains("LLCE") && s.contains("ESPAGNOL") -> "LLCE_ESP"
            (s.contains("NUMERIQUE") && s.contains("INFORMATIQUE")) || s.contains("NSI") -> "NSI"
            (s.contains("SCIENCES NUMERIQUES") && s.contains("TECHNOLOGIE")) || s.contains("SNT") -> "SNT"
            s.contains("ENSEIGNEMENT SCIENTIFIQUE") -> "ES"
            s.contains("HISTOIRE") || s.contains("GEOGRAPHIE") -> "HG"
            s.contains("FRANCAIS") || s.contains("LETTRES") -> "FR"
            s.contains("PHILOSOPHIE") -> "PHILO"
            s.contains("ANGLAIS") || s.split(" ").contains("ANG") -> "ANG"
            s.contains("ESPAGNOL") || s.split(" ").contains("ESP") -> "ESP"
            s.contains("SCIENCES ET TECHNOLOGIE") -> "SCIENCES"
            s.contains("EMC") || s.contains("MORAL") -> "HG"
            else -> null
        }
    }

    /** `https://hote/manuels` + slug -> `https://hote/manuels/<slug>`. */
    fun manualUrl(baseUrl: String, slug: String): String? {
        if (slug.isBlank()) return null
        val trimmed = baseUrl.trim()
        val sep = trimmed.indexOf("://")
        if (sep <= 0) return null
        val rest = trimmed.substring(sep + 3)
        val slash = rest.indexOf('/')
        val originEnd = if (slash < 0) trimmed.length else sep + 3 + slash
        return trimmed.substring(0, originEnd) + "/manuels/" + slug
    }

    /** Chemin normalisé de l'adresse ("" si illisible), sans query ni ancre. */
    private fun pathOf(raw: String): String? {
        val trimmed = raw.trim()
        val sep = trimmed.indexOf("://")
        if (sep <= 0) return null
        val rest = trimmed.substring(sep + 3)
        val slash = rest.indexOf('/')
        if (slash < 0) return ""
        return rest.substring(slash).substringBefore('?').substringBefore('#').trimEnd('/')
    }

    /** Casse et accents neutralisés : « 1ère » et « 1ERE » se ressemblent. */
    private fun words(raw: String): String = Normalizer.normalize(raw, Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "")
        .uppercase(Locale.ROOT)
        .replace(Regex("[^A-Z0-9]+"), " ")
        .trim()
}

package fr.veryslopnynotes.core

// Contexte IA unique (#628) : un SEUL assembleur pour l'aide devoirs, la photo,
// la fiche de révision et le futur chat. Il ne fait aucun réseau, ne lit aucun
// stockage et ne touche à aucun identifiant Pronote : il ordonne, déduplique et
// borne des textes DÉJÀ extraits par les frontières (data/app).
//
// PRIORITÉ EXPLICITE (stable, testée) :
//   devoir/consigne > cours Pronote > pièces jointes > cahier > manuel > web > historique.
//
// BUDGETS DÉCLARÉS UNE SEULE FOIS :
//   - par source = Homework.MAX_SOURCE_CHARS (2 000), le contrat du devoir ;
//   - total      = MAX_OUTPUT_CHARS (12 000), le plafond de la garde I5.
// Les deux viennent de `core` (Homework/LlmGuard), jamais d'une copie. Le
// contexte d'entrée ne dépasse donc pas le plafond de sortie de la garde, et
// chaque source produite reste valide pour `Homework.isRequestValid` (I5) :
// aucun libellé ni texte hors contrat, et le lot tient dans `MAX_SOURCES`.
//
// Une source coupée n'est JAMAIS silencieuse : `truncated = true` et
// `originalChars` disent ce qui a été retiré. Une source écartée (doublon,
// plafond de lot, budget épuisé) est listée dans `omitted`.
//
// Le texte reste une DONNÉE externe : les points d'entrée IA le marquent
// Untrusted (I6). Aucun libellé ne reprend un identifiant, une `ref` opaque ou
// une URL (I4) : le préfixe de type sert de repli si un titre en contient une.
//
// ponytail: bornes alignées sur Homework (contrat). Upgrade: budget par type
// si un modèle à petit contexte exige de réduire les pièces jointes/manuels.

/** Types de sources, dans l'ordre de priorité (valeur petite = plus prioritaire). */
enum class AiContextType(val wire: String, val priority: Int, val prefix: String) {
    ASSIGNMENT("assignment", 0, "Consigne"),
    COURSE("course", 1, "Cours"),
    ATTACHMENT("attachment", 2, "Pièce jointe"),
    NOTE("note", 3, "Cahier"),
    MANUAL("manual", 4, "Manuel"),
    WEB("web", 5, "Page web"),
    HISTORY("history", 6, "Historique"),
}

/**
 * Une source candidate, avant ordonnancement, déduplication et budget.
 *
 * `truncated`/`originalChars` portent une coupe déjà faite par la frontière
 * (extraction d'une pièce jointe bornée, par exemple) : [AiContext] la CONSERVE
 * et la signale, au lieu de laisser croire que la source est entière.
 */
data class AiContextItem(
    val type: AiContextType,
    val label: String,
    val text: String,
    val truncated: Boolean = false,
    val originalChars: Int = text.length,
)

/** Une source réellement envoyée, avec sa taille d'origine et son drapeau de troncature. */
data class AiContextSource(
    val type: AiContextType,
    val label: String,
    val text: String,
    val originalChars: Int,
    val truncated: Boolean,
) {
    /** Miroir compatible avec le contrat devoirs (`HomeworkSource`). */
    fun toHomeworkSource(): HomeworkSource = HomeworkSource(label = label, text = text)
}

/** Raison pour laquelle une candidate n'a pas été envoyée. */
enum class AiContextOmitReason(val wire: String) {
    EMPTY("empty"),
    DUPLICATE("duplicate"),
    MAX_SOURCES("max_sources"),
    BUDGET("budget"),
}

data class AiContextOmitted(
    val type: AiContextType,
    val label: String,
    val reason: AiContextOmitReason,
)

/**
 * Refus déterministe quand aucune source texte n'est exploitable.
 *
 * `actions` porte des CTA STABLES (clés machine) ; l'UI les traduit. Le message
 * est déjà en français, borné, et ne cite aucun identifiant.
 */
data class AiContextRefusal(
    val code: String,
    val message: String,
    val actions: List<String>,
)

/** Point d'entrée IA : l'historique n'est admis que pour le chat. */
enum class AiContextEntry(val wire: String, val allowEmpty: Boolean) {
    HOMEWORK("homework", false),
    PHOTO("photo", true),
    REVISION("revision", false),
    CHAT("chat", false),
}

data class AiContextResult(
    val entry: AiContextEntry,
    val sources: List<AiContextSource>,
    val omitted: List<AiContextOmitted>,
    val totalChars: Int,
    val refusal: AiContextRefusal?,
) {
    fun isEmpty(): Boolean = sources.isEmpty()
}

object AiContext {
    /** Budgets = ceux du contrat devoirs, jamais recopiés (I5). */
    const val MAX_SOURCES = Homework.MAX_SOURCES

    /** Historique du chat : les derniers tours seulement (borné, chat uniquement). */
    const val MAX_HISTORY_ITEMS = 6
    const val MAX_SOURCE_CHARS = Homework.MAX_SOURCE_CHARS
    const val MAX_LABEL_CHARS = Homework.MAX_LABEL_CHARS

    /**
     * Budget total du contexte : le plafond de la garde I5 (12 000 caractères).
     *
     * Il est volontairement PLUS PETIT que 8 sources x 2 000 : le plafond de lot
     * ne suffit pas à borner le coût d'un prompt. Une fois le budget épuisé,
     * les sources suivantes sont écartées avec la raison `budget`.
     */
    const val MAX_TOTAL_CHARS = MAX_OUTPUT_CHARS

    /** Refus stable, identique pour tous les points d'entrée hors photo. */
    const val REFUSAL_CODE = "aucune_source"
    const val REFUSAL_MESSAGE =
        "Aucune source exploitable : ajoute un cours au cahier, active un manuel ou ouvre une pièce jointe."
    val REFUSAL_ACTIONS: List<String> = listOf("add_course", "enable_manual", "open_attachment")

    /**
     * CTA de continuation : l'élève choisit explicitement une réponse non
     * sourcée. Il n'est proposé que par le pont (jamais ajouté à
     * [REFUSAL_ACTIONS], qui reste le refus déterministe des fiches).
     */
    const val REFUSAL_ACTION_PROCEED = "proceed_anyway"

    private val CONTROL_CHARS = Regex("[\\u0000-\\u001f\\u007f]")
    private val SPACES = Regex("\\s+")

    // Espaces Unicode et caractères de format : invisibles à l'écran, mais
    // copiables dans un libellé. `\s` (Java) ne les couvre pas.
    private val INVISIBLE_SPACES = Regex("[\\u00a0\\u202f\\u200b\\u2060\\ufeff]")

    // Une URL ou une `ref` opaque n'a rien à faire dans un libellé citable (I4).
    private val URL_LIKE = Regex("://|^//|data:|\\\\", RegexOption.IGNORE_CASE)
    private val REF_LIKE = Regex("^[a-z]+:[A-Za-z0-9._:-]+$")

    /** Consigne / énoncé du devoir : priorité maximale. */
    fun assignment(text: String): AiContextItem =
        AiContextItem(AiContextType.ASSIGNMENT, AiContextType.ASSIGNMENT.prefix, text)

    /** Cours Pronote rattaché au devoir. */
    fun course(title: String, text: String): AiContextItem =
        AiContextItem(AiContextType.COURSE, labelFor(AiContextType.COURSE, title), text)

    /** Pièce jointe LISIBLE (texte déjà extrait) ; sans texte, elle sera écartée. */
    fun attachment(
        label: String,
        text: String,
        truncated: Boolean = false,
        originalChars: Int = text.length,
    ): AiContextItem =
        AiContextItem(
            AiContextType.ATTACHMENT,
            labelFor(AiContextType.ATTACHMENT, label),
            text,
            truncated = truncated,
            originalChars = originalChars,
        )

    /**
     * Pièce jointe NON LISIBLE : une source NOMMÉE, jamais une exception. Le
     * libellé dit « illisible » et le texte explique pourquoi (format, taille,
     * PDF sans texte…). Le modèle sait ainsi ce qui manque au lieu d'inventer.
     */
    fun attachmentUnreadable(label: String, reason: String): AiContextItem =
        AiContextItem(
            AiContextType.ATTACHMENT,
            labelFor(AiContextType.ATTACHMENT, "$label (illisible)"),
            reason,
        )

    /** Note du cahier local de la matière. */
    fun note(title: String, text: String): AiContextItem =
        AiContextItem(AiContextType.NOTE, labelFor(AiContextType.NOTE, title), text)

    /** Extrait de manuel de la matière. */
    fun manual(title: String, text: String): AiContextItem =
        AiContextItem(AiContextType.MANUAL, labelFor(AiContextType.MANUAL, title), text)

    /** Page web ajoutée par l'élève (texte déjà extrait). */
    fun web(title: String, text: String): AiContextItem =
        AiContextItem(AiContextType.WEB, labelFor(AiContextType.WEB, title), text)

    /** Tour de conversation (chat uniquement), numéroté pour rester citable. */
    fun history(index: Int, role: String, text: String): AiContextItem {
        val cleanRole = sanitizeTitle(role)
        val title = if (cleanRole.isEmpty()) "$index" else "$index — $cleanRole"
        return AiContextItem(AiContextType.HISTORY, labelFor(AiContextType.HISTORY, title), text)
    }

    /**
     * Assemble le corpus pour un point d'entrée. HOMEWORK, PHOTO et REVISION
     * produisent le MÊME corpus (aucun historique) ; CHAT ajoute l'historique
     * fourni, en dernier.
     */
    fun assembleFor(entry: AiContextEntry, items: List<AiContextItem>): AiContextResult =
        assemble(entry, items)

    /**
     * Cœur de l'assembleur : ordre stable par type puis ordre d'entrée, doublons
     * par libellé OU contenu, budgets par source et global, troncature signalée.
     *
     * L'historique n'est admis que pour CHAT, et seulement les derniers tours :
     * les autres points d'entrée (texte, photo, fiche) voient le même corpus.
     * Il passe APRÈS les autres sources, du plus récent au plus ancien : quand
     * le lot ou le budget manque, ce sont les vieux tours qui tombent, jamais
     * les derniers échanges. Les tours retenus sont ensuite remis dans l'ordre
     * chronologique pour que le prompt se lise naturellement.
     */
    fun assemble(entry: AiContextEntry, items: List<AiContextItem>): AiContextResult {
        val history = items.filter { it.type == AiContextType.HISTORY }
        val ordered = items.filterNot { it.type == AiContextType.HISTORY }.withIndex()
            .sortedWith(compareBy({ it.value.type.priority }, { it.index }))
        val sources = ArrayList<AiContextSource>()
        val omitted = ArrayList<AiContextOmitted>()
        val seenLabels = HashSet<String>()
        val seenContents = HashSet<String>()
        var total = 0

        for ((_, item) in ordered) {
            val kept = admit(item, sources, omitted, seenLabels, seenContents, MAX_TOTAL_CHARS - total, true)
            if (kept != null) total += kept.text.length
        }

        if (entry == AiContextEntry.CHAT) {
            // Les tours au-delà du plafond sont ÉCARTÉS, et le disent : une
            // coupe silencieuse ferait croire que tout l'historique est parti.
            for (old in history.dropLast(MAX_HISTORY_ITEMS)) {
                omitted.add(
                    AiContextOmitted(old.type, sanitizeLabel(old.type, old.label), AiContextOmitReason.BUDGET),
                )
            }
            val historyStart = sources.size
            for (item in history.takeLast(MAX_HISTORY_ITEMS).asReversed()) {
                // Un tour de chat n'est JAMAIS un doublon de contenu : « oui »
                // répété reste une réponse distincte. Seul le libellé (unique
                // par index) déduplique.
                val kept = admit(item, sources, omitted, seenLabels, seenContents, MAX_TOTAL_CHARS - total, false)
                if (kept != null) total += kept.text.length
            }
            // Chronologie : le plus ancien tour retenu part en premier.
            sources.subList(historyStart, sources.size).reverse()
        }

        val refusal = if (sources.isEmpty() && !entry.allowEmpty) {
            AiContextRefusal(REFUSAL_CODE, REFUSAL_MESSAGE, REFUSAL_ACTIONS)
        } else {
            null
        }
        return AiContextResult(
            entry = entry,
            sources = sources,
            omitted = omitted,
            totalChars = total,
            refusal = refusal,
        )
    }

    /**
     * Tente d'admettre une candidate dans le lot : vide, doublon, plafond de
     * sources puis budget, dans cet ordre. Retourne la source réellement
     * retenue, ou `null` avec une raison dans `omitted`.
     *
     * `dedupeContent = false` pour l'historique : un tour de chat répété
     * (« oui », « oui ») est une réponse distincte, pas un doublon.
     */
    private fun admit(
        item: AiContextItem,
        sources: MutableList<AiContextSource>,
        omitted: MutableList<AiContextOmitted>,
        seenLabels: MutableSet<String>,
        seenContents: MutableSet<String>,
        remaining: Int,
        dedupeContent: Boolean,
    ): AiContextSource? {
        val sourceLabel = sanitizeLabel(item.type, item.label)
        val text = item.text.trim()
        if (text.isEmpty()) {
            omitted.add(AiContextOmitted(item.type, sourceLabel, AiContextOmitReason.EMPTY))
            return null
        }
        val labelKey = sourceLabel.lowercase()
        // Contenu : casse CONSERVÉE (une formule change de sens en changeant
        // de casse) ; seuls les blancs sont normalisés.
        val contentKey = text.replace(SPACES, " ")
        if (labelKey in seenLabels || (dedupeContent && contentKey in seenContents)) {
            omitted.add(AiContextOmitted(item.type, sourceLabel, AiContextOmitReason.DUPLICATE))
            return null
        }
        if (sources.size >= MAX_SOURCES) {
            omitted.add(AiContextOmitted(item.type, sourceLabel, AiContextOmitReason.MAX_SOURCES))
            return null
        }
        if (remaining <= 0) {
            omitted.add(AiContextOmitted(item.type, sourceLabel, AiContextOmitReason.BUDGET))
            return null
        }
        val cap = minOf(MAX_SOURCE_CHARS, remaining)
        // Une coupe déjà faite en amont (extraction bornée) reste SIGNALÉE :
        // le drapeau de l'item et sa taille d'origine ne sont jamais perdus.
        val truncated = item.truncated || text.length > cap
        val originalChars = maxOf(item.originalChars, text.length)
        val kept = if (text.length > cap) text.take(cap).trimEnd() else text
        if (kept.isEmpty()) {
            omitted.add(AiContextOmitted(item.type, sourceLabel, AiContextOmitReason.EMPTY))
            return null
        }
        // Le premier candidat RETENU gagne : un doublon d'une source écartée
        // (budget, plafond) n'est pas un doublon de ce qui part vraiment.
        seenLabels.add(labelKey)
        if (dedupeContent) seenContents.add(contentKey)
        val source = AiContextSource(
            type = item.type,
            label = sourceLabel,
            text = kept,
            originalChars = originalChars,
            truncated = truncated,
        )
        sources.add(source)
        return source
    }

    /**
     * Assainit un titre : invisibles (espaces Unicode et caractères de format)
     * deviennent une espace normale avant le repli des blancs. Aucun caractère
     * invisible ne doit survivre dans un libellé citable.
     */
    private fun sanitizeTitle(raw: String): String =
        raw.replace(INVISIBLE_SPACES, " ")
            .replace(CONTROL_CHARS, " ")
            .replace(SPACES, " ")
            .trim()

    /**
     * Borne un libellé à [MAX_LABEL_CHARS] sans couper une paire de
     * substitution : un demi-caractère échapperait au rendu et à la citation.
     */
    private fun clampLabel(label: String): String {
        if (label.length <= MAX_LABEL_CHARS) return label
        val cut = if (Character.isHighSurrogate(label[MAX_LABEL_CHARS - 1])) {
            MAX_LABEL_CHARS - 1
        } else {
            MAX_LABEL_CHARS
        }
        return label.substring(0, cut)
    }

    /**
     * Construit un libellé citable STABLE : préfixe de type + titre assaini.
     * Un titre vide retombe sur le préfixe ; une URL ou une `ref` n'entre
     * jamais dans un libellé (I4). Le résultat tient dans [MAX_LABEL_CHARS].
     */
    fun labelFor(type: AiContextType, title: String): String {
        val clean = sanitizeTitle(title)
        val unsafe = clean.isEmpty() || URL_LIKE.containsMatchIn(clean) || REF_LIKE.matches(clean)
        val safe = if (unsafe) type.prefix else "${type.prefix} : $clean"
        return clampLabel(safe).trim()
    }

    /**
     * Assainit un libellé DÉJÀ formé (sortie de [labelFor] ou libellé fourni par
     * un appelant) : blancs/contrôles retirés, borne respectée, URL interdite.
     * Le libellé final est ce que le modèle peut citer TEL QUEL.
     */
    private fun sanitizeLabel(type: AiContextType, raw: String): String {
        val clean = sanitizeTitle(raw)
        val unsafe = clean.isEmpty() || URL_LIKE.containsMatchIn(clean) || REF_LIKE.matches(clean)
        val safe = if (unsafe) type.prefix else clean
        return clampLabel(safe).trim()
    }
}

package fr.veryslopnynotes.data

/**
 * Règles des préférences matière — la SOURCE UNIQUE de vérité.
 *
 * Le pont (`app/VsnBridge.kt`) et le dépôt (`SubjectPrefsRepository`) doivent
 * dire la MÊME chose sur ce qu'est une matière valide : sinon le pont répond
 * `ok`, le dépôt abandonne l'écriture, et l'interface annonce « enregistré »
 * pour une perte de données silencieuse.
 *
 * Fichier PUR (ni `org.json`, ni `android.*`) : le harnais de parité le
 * compile et l'EXÉCUTE. Ces règles BORNENT aussi l'entrée du pont (I10) :
 * jamais 256 Ko recopiés vers le disque.
 */

enum class SubjectPrefField {
    SUBJECT,

    COLOR,

    EMOJI,

    LABEL,
}

/**
 * Matière lue d'une frontière : conforme (normalisée et bornée) ou refusée.
 * `Valid` porte les valeurs NORMALISÉES (trim, vide = absent) : ce qui arrive
 * au dépôt tient dans les limites, par construction.
 */
sealed class SubjectPrefInput {
    data class Valid(
        val subject: String,
        val color: String?,
        val emoji: String?,
        val label: String?,
    ) : SubjectPrefInput()

    data class Invalid(val field: SubjectPrefField) : SubjectPrefInput()
}

object SubjectPrefRules {
    const val MAX_SUBJECT_CHARS = 64

    /** Longueur de l'emoji, en POINTS DE CODE (une paire de substitution = 1). */
    const val MAX_EMOJI_CHARS = 8

    const val MAX_LABEL_CHARS = 64

    const val MAX_COLOR_CHARS = 7

    private val COLOR_RE = Regex("^#[0-9a-fA-F]{6}$")

    /**
     * Champ hors contrat, ou `null` si la matière est conforme. MÊME règle que
     * `SubjectPrefs.isValid` (qui s'appuie dessus) : une seule vérité.
     */
    fun invalidField(
        subject: String,
        color: String?,
        emoji: String?,
        label: String?,
    ): SubjectPrefField? = when {
        subject.trim().isEmpty() || subject.length > MAX_SUBJECT_CHARS -> SubjectPrefField.SUBJECT
        color != null && (color.length > MAX_COLOR_CHARS || !COLOR_RE.matches(color)) -> SubjectPrefField.COLOR
        emoji != null && (
            emoji.trim().isEmpty() ||
                emoji.codePointCount(0, emoji.length) > MAX_EMOJI_CHARS
            ) -> SubjectPrefField.EMOJI
        label != null && (label.trim().isEmpty() || label.length > MAX_LABEL_CHARS) -> SubjectPrefField.LABEL
        else -> null
    }

    /**
     * Lecture BORNÉE d'une matière venue d'une frontière : normalise (trim,
     * vide = absent) puis valide. La valeur renvoyée est conforme, ou le champ
     * fautif est nommé — jamais l'entrée brute.
     */
    fun read(
        subject: String,
        color: String,
        emoji: String,
        label: String,
    ): SubjectPrefInput {
        val s = subject.trim()
        val c = color.trim().takeIf { it.isNotEmpty() }
        val e = emoji.trim().takeIf { it.isNotEmpty() }
        val l = label.trim().takeIf { it.isNotEmpty() }
        val field = invalidField(s, c, e, l)
        return if (field == null) {
            SubjectPrefInput.Valid(s, c, e, l)
        } else {
            SubjectPrefInput.Invalid(field)
        }
    }
}

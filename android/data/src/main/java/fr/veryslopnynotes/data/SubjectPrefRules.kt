package fr.veryslopnynotes.data

/**
 * Règles des préférences matière — la SOURCE UNIQUE de vérité (#395).
 *
 * Le pont (`app/VsnBridge.kt`) et le dépôt (`SubjectPrefsRepository`) doivent
 * dire la MÊME chose sur ce qu'est une matière valide. Avant, ils ne le
 * faisaient pas : le pont ne validait que le NOM de la matière et répondait
 * `ok` quoi qu'il arrive, pendant que le dépôt ABANDONNAIT l'écriture d'une
 * couleur, d'un emoji ou d'un libellé hors contrat. L'interface affichait
 * « enregistré » et rien n'était écrit : une perte de données SILENCIEUSE.
 *
 * Ces règles vivent dans un fichier PUR (ni `org.json`, ni `android.*`) : le
 * harnais de parité les compile et les EXÉCUTE, donc le test porte sur le
 * comportement réel, pas sur un miroir TS.
 *
 * Elles BORNENT aussi l'entrée du pont (frontière de confiance, I10) : une
 * couleur, un emoji ou un libellé venus du JS sont refusés au-delà de leur
 * limite — jamais 256 Ko recopiés vers le disque.
 */

/** Champ hors contrat d'une matière. */
enum class SubjectPrefField {
    /** Nom de la matière. */
    SUBJECT,

    /** Couleur `#RRGGBB`. */
    COLOR,

    /** Emoji court. */
    EMOJI,

    /** Libellé affiché. */
    LABEL,
}

/**
 * Matière lue d'une frontière : conforme (normalisée et bornée) ou refusée.
 *
 * `Valid` porte les valeurs NORMALISÉES (trim, vide = absent) : ce qui
 * arrive au dépôt tient dans les limites, par construction.
 */
sealed class SubjectPrefInput {
    /** Matière conforme. */
    data class Valid(
        val subject: String,
        val color: String?,
        val emoji: String?,
        val label: String?,
    ) : SubjectPrefInput()

    /** Un champ est hors contrat : rien ne sera écrit. */
    data class Invalid(val field: SubjectPrefField) : SubjectPrefInput()
}

/** Bornes et contrat d'une matière. */
object SubjectPrefRules {
    /** Longueur du nom de matière. */
    const val MAX_SUBJECT_CHARS = 64

    /** Longueur de l'emoji, en POINTS DE CODE (une paire de substitution = 1). */
    const val MAX_EMOJI_CHARS = 8

    /** Longueur du libellé affiché. */
    const val MAX_LABEL_CHARS = 64

    /** Longueur d'une couleur : `#` + 6 chiffres hexadécimaux. */
    const val MAX_COLOR_CHARS = 7

    private val COLOR_RE = Regex("^#[0-9a-fA-F]{6}$")

    /**
     * Champ hors contrat, ou `null` si la matière est conforme.
     *
     * MÊME règle que `SubjectPrefs.isValid` (qui s'appuie sur cette
     * fonction) : une seule vérité, donc le pont ne peut pas valider moins
     * que le dépôt — ni l'inverse.
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
     * Lecture BORNÉE d'une matière venue d'une frontière (le pont).
     *
     * Normalise (trim, vide = absent) puis valide : la valeur renvoyée est
     * conforme, ou le champ fautif est nommé — jamais l'entrée brute.
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

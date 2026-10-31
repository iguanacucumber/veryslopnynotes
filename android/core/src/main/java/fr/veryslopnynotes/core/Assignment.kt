package fr.veryslopnynotes.core

// Devoir enrichi : miroir de shared/contracts/models.ts Assignment.
// description/contenu de cours = texte enseignant, DONNÉE bornée affichée via
// Text() seul, jamais instruction (I6). Pièces jointes : `ref` OPAQUE, jamais
// une URL Pronote (I1).
// ponytail: pas de lib date — l'affichage lit l'ISO via `DateFr.kt`.
data class AssignmentAttachment(
    val id: String,
    val label: String,
    val ref: String,
) {
    companion object {
        const val MAX_LABEL = 200
        const val MAX_REF = 200

        /**
         * Schéma d'une `ref` de devoir : clé interne `homework:<devoir>:<piece>:<id>`.
         *
         * MÊME forme que le parseur web et le contrat TS : une `ref` hors schéma
         * fait PERDRE le devoir ENTIER côté web, pas seulement sa pièce jointe.
         */
        private val HOMEWORK_REF = Regex("^homework:[A-Za-z0-9._:-]+$")

        /** Caractères de contrôle : jamais dans une `ref` (même règle que le contrat). */
        private val CONTROL_CHARS = Regex("[\\u0000-\\u001f\\u007f]")

        // Formes d'URL INTERDITES dans une ref : référence interne uniquement.
        // Sans distinction de casse ; garde-fou explicite (I1).
        private val ABSOLUTE_REF = Regex("://|^//|data:|\\\\", RegexOption.IGNORE_CASE)

        fun isValid(a: AssignmentAttachment): Boolean =
            a.id.isNotBlank() &&
                a.label.isNotBlank() && a.label.length <= MAX_LABEL &&
                isRefValid(a.ref)

        private fun isRefValid(ref: String): Boolean =
            ref.isNotBlank() && ref.length <= MAX_REF &&
                !CONTROL_CHARS.containsMatchIn(ref) &&
                !ABSOLUTE_REF.containsMatchIn(ref) &&
                HOMEWORK_REF.matches(ref)

        /**
         * `ref` d'une pièce jointe : `homework:<devoir>:file:<piece>:<id>`.
         *
         * L'identifiant Pronote est ASSAINI, jamais refusé : une `ref` hors
         * schéma ferait disparaître le devoir entier côté web.
         *
         * ponytail: la `ref` est une CLÉ, pas une URL : la sanitisation n'a pas
         * à être réversible.
         */
        fun homeworkRef(homeworkIndex: Int, fileIndex: Int, fileId: String): String? =
            refOf("homework:$homeworkIndex:file:$fileIndex:", fileId)

        /**
         * `ref` d'une pièce jointe de COURS : `homework:<devoir>:lesson:<cours>:file:<piece>:<id>`.
         * Le segment `lesson:` distingue un fichier de cours d'un fichier de devoir.
         */
        fun lessonAttachmentRef(
            homeworkIndex: Int,
            lessonIndex: Int,
            fileIndex: Int,
            fileId: String,
        ): String? =
            refOf("homework:$homeworkIndex:lesson:$lessonIndex:file:$fileIndex:", fileId)

        private fun refOf(prefix: String, fileId: String): String? {
            val clean = sanitizeRefPart(fileId)
            if (clean.isEmpty()) return null
            val room = MAX_REF - prefix.length
            if (room <= 0) return null
            val ref = prefix + clean.take(room)
            return if (isRefValid(ref)) ref else null
        }

        private fun sanitizeRefPart(raw: String): String {
            val text = raw.trim()
            val out = StringBuilder()
            var i = 0
            while (i < text.length) {
                val cp = text.codePointAt(i)
                out.append(if (isRefIdChar(cp)) String(Character.toChars(cp)) else "_")
                i += Character.charCount(cp)
            }
            return out.toString()
        }

        private fun isRefIdChar(cp: Int): Boolean =
            (cp in 'a'.code..'z'.code) ||
                (cp in 'A'.code..'Z'.code) ||
                (cp in '0'.code..'9'.code) ||
                cp == '.'.code || cp == '_'.code || cp == ':'.code || cp == '-'.code
    }
}

data class AssignmentLessonContent(
    val title: String,
    val excerpt: String,
    /** Pièces jointes du cours (#631), bornées comme celles du devoir. */
    val attachments: List<AssignmentAttachment> = emptyList(),
) {
    companion object {
        const val MAX_TITLE = 200

        /**
         * Borne de PAYLOAD du cours rattaché : 8 000 caractères, la même que le
         * manuel. Le prompt garde son budget propre (2 000 par source) et SIGNALE
         * la coupe ; cette borne évite seulement de garder un cours géant en cache.
         */
        const val MAX_EXCERPT = 8000

        fun isValid(c: AssignmentLessonContent): Boolean =
            c.title.isNotBlank() &&
                c.title.length <= MAX_TITLE &&
                c.excerpt.length <= MAX_EXCERPT &&
                c.attachments.size <= Assignment.MAX_ATTACHMENTS &&
                c.attachments.all { AssignmentAttachment.isValid(it) }
    }
}

data class Assignment(
    val id: String,
    val subject: String,
    val title: String,
    val dueDate: String,
    val done: Boolean,
    val description: String = "",
    val lessonContent: AssignmentLessonContent? = null,
    val attachments: List<AssignmentAttachment> = emptyList(),
    val periodId: String? = null,
    val weekId: String? = null,
    /**
     * TOUS les cours rattachés à la même matière + jour. `lessonContent` reste le
     * premier, pour les lecteurs qui ne connaissent que le champ singulier.
     */
    val lessonContents: List<AssignmentLessonContent> = emptyList(),
) {
    /** Cours publiés, sans doublon, dans l'ordre du payload. */
    fun allLessonContents(): List<AssignmentLessonContent> {
        val listed = if (lessonContents.isNotEmpty()) lessonContents else listOfNotNull(lessonContent)
        if (lessonContent == null || lessonContent in listed) return listed
        return listOf(lessonContent) + listed
    }

    /** Pièces jointes du devoir ET de ses cours, une seule fois par `ref`. */
    fun allAttachments(): List<AssignmentAttachment> =
        (attachments + allLessonContents().flatMap { it.attachments }).distinctBy { it.ref }

    companion object {
        const val MAX_DESCRIPTION = 2000
        const val MAX_ATTACHMENTS = 10
        const val MAX_LESSONS = 10

        fun isValid(a: Assignment): Boolean {
            if (a.id.isBlank() || a.subject.isBlank() || a.title.isBlank()) return false
            if (a.description.length > MAX_DESCRIPTION) return false
            if (a.attachments.size > MAX_ATTACHMENTS) return false
            if (a.attachments.any { !AssignmentAttachment.isValid(it) }) return false
            if (a.lessonContent != null && !AssignmentLessonContent.isValid(a.lessonContent)) return false
            if (a.lessonContents.size > MAX_LESSONS) return false
            if (a.lessonContents.any { !AssignmentLessonContent.isValid(it) }) return false
            return true
        }
    }
}

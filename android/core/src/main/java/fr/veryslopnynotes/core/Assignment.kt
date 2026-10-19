package fr.veryslopnynotes.core

// Devoir enrichi #75 : miroir de shared/contracts/models.ts Assignment.
// description/contenu de cours = texte enseignant, DONNÉE bornée affichée via
// Text() seul (jamais WebView, jamais Html, jamais instruction — I6).
// Pièces jointes : `ref` OPAQUE résolue par l'identifiant de la pièce
// (jamais une URL Pronote : règle d'or média, I1).
// ponytail: pas de lib date — la date affichée vient de `DateFr.kt`
// (`dayLabelFr`), qui lit l'ISO avec `java.time` (minSdk 26).
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
         * MÊME forme que le parseur web (`web/src/features/tasks/assignments.ts`)
         * et que le contrat TS (`shared/contracts/models.ts`) : une `ref` hors
         * schéma fait PERDRE le devoir ENTIER côté web (titre, consigne,
         * échéance), pas seulement sa pièce jointe. On n'accepte donc que ce
         * que les deux autres lireurs savent lire.
         */
        private val HOMEWORK_REF = Regex("^homework:[A-Za-z0-9._:-]+$")

        /** Caractères de contrôle : jamais dans une `ref` (même règle que le contrat). */
        private val CONTROL_CHARS = Regex("[\\u0000-\\u001f\\u007f]")

        // Formes d'URL INTERDITES dans une ref : référence interne uniquement.
        // Sans distinction de casse (`DATA:` comme `data:`), comme le contrat.
        // Le schéma `homework:` les exclut déjà : garde-fou explicite (I1).
        private val ABSOLUTE_REF = Regex("://|^//|data:|\\\\", RegexOption.IGNORE_CASE)

        fun isValid(a: AssignmentAttachment): Boolean =
            a.id.isNotBlank() &&
                a.label.isNotBlank() && a.label.length <= MAX_LABEL &&
                isRefValid(a.ref)

        /** Une `ref` lisible par les deux autres lecteurs (web + contrat TS). */
        private fun isRefValid(ref: String): Boolean =
            ref.isNotBlank() && ref.length <= MAX_REF &&
                !CONTROL_CHARS.containsMatchIn(ref) &&
                !ABSOLUTE_REF.containsMatchIn(ref) &&
                HOMEWORK_REF.matches(ref)

        /**
         * `ref` d'une pièce jointe : `homework:<devoir>:file:<piece>:<id>`.
         *
         * L'identifiant Pronote est ASSAINI, jamais refusé : un identifiant
         * exotique (« 12 34 ») produirait une `ref` hors schéma, et le refus
         * ferait disparaître le devoir entier côté web — on perdrait la pièce
         * jointe, le titre et l'échéance pour un simple espace.
         *
         * ponytail: la `ref` est une CLÉ (la pièce est résolue par son `id`),
         * pas une URL : la sanitisation n'a donc pas à être réversible.
         */
        fun homeworkRef(homeworkIndex: Int, fileIndex: Int, fileId: String): String? {
            val clean = sanitizeRefPart(fileId)
            if (clean.isEmpty()) return null
            val prefix = "homework:$homeworkIndex:file:$fileIndex:"
            val room = MAX_REF - prefix.length
            if (room <= 0) return null
            val ref = prefix + clean.take(room)
            return if (isRefValid(ref)) ref else null
        }

        /** Identifiant rendu conforme au schéma : tout caractère exotique devient `_`. */
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

        /** Caractères autorisés dans la partie `id` d'une `ref` (hors `homework:`). */
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
) {
    companion object {
        const val MAX_TITLE = 200
        const val MAX_EXCERPT = 500

        fun isValid(c: AssignmentLessonContent): Boolean =
            c.title.isNotBlank() && c.title.length <= MAX_TITLE && c.excerpt.length <= MAX_EXCERPT
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
) {
    companion object {
        const val MAX_DESCRIPTION = 2000
        const val MAX_ATTACHMENTS = 10

        fun isValid(a: Assignment): Boolean {
            if (a.id.isBlank() || a.subject.isBlank() || a.title.isBlank()) return false
            if (a.description.length > MAX_DESCRIPTION) return false
            if (a.attachments.size > MAX_ATTACHMENTS) return false
            if (a.attachments.any { !AssignmentAttachment.isValid(it) }) return false
            if (a.lessonContent != null && !AssignmentLessonContent.isValid(a.lessonContent)) return false
            return true
        }

        // #147 : le badge « lundi 05/10 » (dérivé de `dueDate`, jamais un champ
        // du contrat) est parti dans `DateFr.kt` — `dayLabelFr`, l'unique
        // implémentation des dates françaises, et `isoDayKey` pour la clé de
        // regroupement des devoirs par jour. Les deux tables de jour qui
        // coexistaient ici et dans l'écran Cantine ont disparu.
    }
}

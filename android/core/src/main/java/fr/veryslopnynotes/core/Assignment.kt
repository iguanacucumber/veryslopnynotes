package fr.veryslopnynotes.core

// Devoir enrichi #75 : miroir de shared/contracts/models.ts Assignment.
// description/contenu de cours = texte enseignant, DONNÉE bornée affichée via
// Text() seul (jamais WebView, jamais Html, jamais instruction — I6).
// Pièces jointes : `ref` OPAQUE résolue par le proxy serveur (/v1/media).
// Une URL absolue dans `ref` est rejetée par isValid : aucune URL Pronote/ENT
// ne peut atteindre l'app (I1, règle d'or média).
// ponytail: dates = 10 premiers caractères de l'ISO (stdlib seule, pas de lib
// date) ; le badge semaine est dérivé de dueDate côté UI, jamais stocké.
data class AssignmentAttachment(
    val id: String,
    val label: String,
    val ref: String,
) {
    companion object {
        const val MAX_LABEL = 200
        const val MAX_REF = 200

        // Formes d'URL INTERDITES dans une ref : référence interne uniquement.
        private val ABSOLUTE_REF = Regex("://|^//|data:|\\\\")

        fun isValid(a: AssignmentAttachment): Boolean =
            a.id.isNotBlank() &&
                a.label.isNotBlank() && a.label.length <= MAX_LABEL &&
                a.ref.isNotBlank() && a.ref.length <= MAX_REF &&
                !ABSOLUTE_REF.containsMatchIn(a.ref)
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

        fun dayLabel(iso: String): String = if (iso.length >= 10) iso.substring(0, 10) else ""

        /** "lundi 05/10" : badge semaine dérivé de dueDate, jamais un champ du contrat. */
        fun dayLabelFr(iso: String): String {
            val day = dayLabel(iso)
            if (day.length < 10) return day
            val names = listOf("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")
            val index = runCatching { java.time.LocalDate.parse(day).dayOfWeek.value % 7 }.getOrDefault(-1)
            val name = if (index < 0) "" else "${names[index]} "
            return "$name${day.substring(8, 10)}/${day.substring(5, 7)}"
        }
    }
}
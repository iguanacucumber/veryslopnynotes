package fr.veryslopnynotes.core

// Sources d'un devoir pour l'assembleur IA. PUR (aucun réseau, aucun stockage) :
// ce fichier ne fait qu'ordonner consigne, cours et pièces jointes déjà extraites.
//
// PLUSIEURS cours peuvent être rattachés au même devoir (même matière + jour) :
// tous sont des sources citables. La coupe est faite par [AiContext], qui la
// SIGNALE (`truncated`).

/**
 * Candidates IA d'un devoir : consigne, puis TOUS les cours rattachés, puis les
 * pièces jointes déjà extraites. Aucune source vide n'est ajoutée.
 *
 * [attachments] contient les résultats DÉJÀ bornés/marqués de la frontière : ils
 * arrivent après les cours, et [AiContext] garde l'ordre de priorité stable.
 */
fun assignmentContextItems(
    assignment: Assignment,
    attachments: List<AiContextItem> = emptyList(),
): List<AiContextItem> {
    val out = mutableListOf<AiContextItem>()
    if (assignment.description.isNotBlank()) {
        out.add(AiContext.assignment(assignment.description))
    }
    for (lesson in assignment.allLessonContents()) {
        if (lesson.excerpt.isNotBlank()) {
            out.add(AiContext.course(lesson.title, lesson.excerpt))
        }
    }
    out.addAll(attachments)
    return out
}

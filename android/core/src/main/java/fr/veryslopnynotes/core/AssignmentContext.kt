package fr.veryslopnynotes.core

// #631 : sources d'un devoir pour l'assembleur IA. PUR (aucun réseau, aucun
// stockage) : la frontière `data` fournit déjà le texte extrait des pièces
// jointes ; ce fichier ne fait qu'ordonner consigne, cours et pièces jointes.
//
// PLUSIEURS cours peuvent être rattachés au même devoir (même matière + jour) :
// tous sont des sources citables. Un cours de 8 000 caractères n'est jamais
// coupé ici à 500 : [AiContext] applique son budget de source et SIGNALE la
// coupe (`truncated`).

/**
 * Candidates IA d'un devoir : consigne, puis TOUS les cours rattachés, puis
 * les pièces jointes déjà extraites. Aucune source vide n'est ajoutée.
 *
 * [attachments] contient les résultats DÉJÀ bornés/marqués de la frontière
 * (texte lisible, ou source « illisible » nommée). Les pièces jointes arrivent
 * après les cours : [AiContext] garde l'ordre de priorité stable.
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

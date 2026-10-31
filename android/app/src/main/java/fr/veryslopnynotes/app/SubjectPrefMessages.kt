package fr.veryslopnynotes.app

import fr.veryslopnynotes.data.SubjectPrefField
import fr.veryslopnynotes.data.SubjectPrefRules

/**
 * Ce qui traverse le pont est une phrase BORNÉE choisie ici : jamais l'entrée
 * brute (une couleur de 256 Ko ne franchit pas la frontière) ni un message
 * d'exception. Fichier PUR : le harnais de parité l'exécute.
 */
fun subjectPrefIssueMessage(field: SubjectPrefField): String = when (field) {
    SubjectPrefField.SUBJECT ->
        "Matière invalide : de 1 à ${SubjectPrefRules.MAX_SUBJECT_CHARS} caractères."
    SubjectPrefField.COLOR ->
        "Couleur invalide : attends #RRGGBB."
    SubjectPrefField.EMOJI ->
        "Emoji invalide : ${SubjectPrefRules.MAX_EMOJI_CHARS} points de code maximum."
    SubjectPrefField.LABEL ->
        "Libellé invalide : ${SubjectPrefRules.MAX_LABEL_CHARS} caractères maximum."
}

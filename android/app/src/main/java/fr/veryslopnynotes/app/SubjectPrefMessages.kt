package fr.veryslopnynotes.app

import fr.veryslopnynotes.data.SubjectPrefField
import fr.veryslopnynotes.data.SubjectPrefRules

/**
 * Phrases de refus d'une matière hors contrat (#395).
 *
 * Le pont traverse la frontière native/JS : ce qui sort ne peut être qu'une
 * phrase BORNÉE, choisie ici — jamais l'entrée brute (une couleur de 256 Ko
 * ne franchit pas la frontière) et jamais un message d'exception. La phrase
 * dit POURQUOI la matière est refusée, pour que l'élève corrige sa saisie.
 *
 * Fichier PUR (ni `android.*`, ni `org.json`) : le harnais de parité le
 * compile et l'EXÉCUTE, comme `PairingMessages.kt` et `HomeworkMessages.kt`.
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

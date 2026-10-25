package fr.veryslopnynotes.app

/**
 * Messages de refus de l'assistant choisis PAR LE PONT (#416).
 *
 * Un refus traverse la frontière native/JS : ce qui sort du pont ne peut être
 * qu'une PHRASE française bornée. Le motif du modèle
 * (`HomeworkOutcome.Refused.reason`, `core/HomeworkAi.kt`) est un texte LIBRE :
 * il peut être un echo de la consigne, une autre cause, une phrase invérifiable.
 * L'afficher tel quel donnerait à l'élève un diagnostic faux — « pas assez de
 * matière » alors que le modèle a refusé pour une autre raison — et laisserait
 * passer un echo de la consigne dans l'interface (I6 : ce qui n'est pas écrit
 * par un humain est une DONNÉE, jamais une consigne affichée comme telle).
 *
 * Donc : le pont ne transmet JAMAIS le motif, il le MAPPE sur une phrase de
 * sa table. Le jeton déterministe garde SA phrase (« pas assez de matière ») ;
 * toute autre raison tombe sur une phrase générique — un refus sans cause
 * affirmée vaut mieux qu'une cause fausse.
 *
 * Fichier PUR (aucun import) : il se compile SEUL, comme `PairingMessages.kt`.
 */

/** Plafond de la phrase de refus (même borne que `bounded(...)` côté pont). */
const val HOMEWORK_REFUSAL_MESSAGE_MAX_CHARS = 200

/**
 * Jeton déterministe du refus « sources insuffisantes ».
 *
 * Redéfini ici : le module `app` dépend de `core`, mais l'inverse n'est pas
 * vrai, et `core/HomeworkAi.kt` n'est pas dans le port de parité (ce fichier
 * doit se compiler seul). Valeur = `HOMEWORK_REFUSAL_REASON`
 * (`android/core/src/main/java/fr/veryslopnynotes/core/HomeworkAi.kt`).
 */
private const val SOURCES_INSUFFISANTES = "sources_insuffisantes"

/** Refus déterministe : c'est la MATIÈRE qui manque, pas l'intention. */
// #608 : la phrase disait « refuse de répondre sans source » alors que des
// sources ONT été envoyées (consigne, cours, manuel, cahier) — le modèle les
// juge seulement insuffisantes. Diagnostic faux, corrigé ici.
private const val REFUSAL_SOURCES =
    "Le devoir n'a pas assez de matière : les sources fournies ne suffisent pas pour répondre."

/** Refus pour une autre raison : on n'affirme aucune cause. */
private const val REFUSAL_GENERIQUE = "L'assistant a refusé de répondre à cette question."

/**
 * Phrase de refus affichée, choisie par le pont.
 *
 * @param reason motif libre du modèle (JAMAIS affiché tel quel).
 * @return une phrase française, non vide et bornée.
 */
fun homeworkRefusalMessage(reason: String): String {
    val phrase =
        if (reason.trim().lowercase() == SOURCES_INSUFFISANTES) REFUSAL_SOURCES else REFUSAL_GENERIQUE
    // Bornée par construction : la phrase sort d'une table fermée, jamais du modèle.
    return phrase.take(HOMEWORK_REFUSAL_MESSAGE_MAX_CHARS)
}

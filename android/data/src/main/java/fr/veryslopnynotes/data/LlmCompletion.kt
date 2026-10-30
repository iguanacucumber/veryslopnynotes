package fr.veryslopnynotes.data

// Règles PURES de lecture d'une complétion de chat : `finish_reason` + contenu
// -> texte accepté ou refus MOTIVÉ. Fichier `java.*` SEUL (ni OkHttp, ni
// `org.json`) : il est compilé et exécuté par la parité Kotlin, hors Gradle.
// Le décodage JSON et la traduction en `LlmError` restent dans
// `OpenRouterLlm.kt`.

/** Verdict borné d'une complétion : jamais un texte réinterprété. */
sealed interface LlmCompletion {
    /** Contenu exploitable, tel que le fournisseur l'a rendu. */
    data class Text(val value: String) : LlmCompletion

    /** Refus nommé : la cause est le [fault], jamais un texte libre du modèle. */
    data class Refused(val fault: LlmCompletionFault) : LlmCompletion
}

/**
 * Cause d'un refus de complétion, avec son message affichable.
 *
 * Un `finish_reason` autre que `stop`/`length` (`content_filter`, `error`,
 * valeur inconnue) signifie que le fournisseur a COUPÉ la génération : le
 * contenu partiel n'est pas une réponse, et « hors format » serait un
 * diagnostic faux (I4/I14).
 */
enum class LlmCompletionFault(val message: String) {
    /** Budget de tokens atteint : sortie incomplète (I5). */
    TRUNCATED("Réponse LLM tronquée (limite de longueur atteinte)."),

    /** Filtre de contenu, erreur amont ou fin inconnue : génération coupée. */
    INTERRUPTED("Réponse LLM interrompue par le fournisseur : réessaie."),

    /** `content` absent, nul, vide ou non textuel : rien à valider. */
    EMPTY("Réponse LLM vide."),

    /** Pas de `choices` exploitable : l'enveloppe n'est pas une complétion. */
    UNREADABLE("Réponse LLM illisible (JSON invalide)."),
}

/**
 * Lit une complétion déjà décodée : [choiceCount] = nombre de choix
 * exploitables (0 si `choices` absent, vide ou sans objet), [finishReason] =
 * valeur texte de `finish_reason` (`null` si absente ou JSON `null`),
 * [content] = texte de `message.content` (`null` si absent, nul ou non
 * textuel — un tableau n'est pas une réponse).
 *
 * Seuls `stop` et l'absence de `finish_reason` valent « complète » : tout
 * autre verdict est un refus nommé, jamais le contenu partiel.
 */
fun readCompletion(
    choiceCount: Int,
    finishReason: String?,
    content: String?,
): LlmCompletion {
    if (choiceCount <= 0) return LlmCompletion.Refused(LlmCompletionFault.UNREADABLE)
    when (finishReason) {
        // Absent = le fournisseur n'a rien signalé ; `stop` = fin normale.
        null, "stop" -> Unit
        "length" -> return LlmCompletion.Refused(LlmCompletionFault.TRUNCATED)
        // `content_filter`, `error` et toute valeur inconnue : coupé, pas fini.
        else -> return LlmCompletion.Refused(LlmCompletionFault.INTERRUPTED)
    }
    if (content.isNullOrBlank()) return LlmCompletion.Refused(LlmCompletionFault.EMPTY)
    return LlmCompletion.Text(content)
}

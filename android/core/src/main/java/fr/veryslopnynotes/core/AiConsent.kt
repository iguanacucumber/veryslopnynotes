package fr.veryslopnynotes.core

// Consentement de premier usage de l'assistant IA (PRV-04). Fichier PUR : la
// version, la décision et la lecture d'un enregistrement sont exécutées par la
// parité, sans Android. Le stockage vit dans `data/AiConsentStore.kt`.

/** Version du texte et du périmètre acceptés. Une version inconnue = refus. */
const val AI_CONSENT_VERSION = 1

enum class AiConsentDecision(val wire: String) {
    NONE("none"),
    GRANTED("granted"),
    REFUSED("refused"),
    WITHDRAWN("withdrawn"),
    ;

    companion object {
        fun fromWire(raw: String?): AiConsentDecision =
            entries.firstOrNull { it.wire == raw?.trim()?.lowercase() } ?: NONE
    }
}

data class AiConsentRecord(val decision: AiConsentDecision, val version: Int) {
    /** Seul un accord explicite à la version courante autorise un appel IA. */
    val allowsAi: Boolean
        get() = decision == AiConsentDecision.GRANTED && version == AI_CONSENT_VERSION
}

/** Enregistrement illisible, inconnu ou d'une autre version = aucun accord. */
fun parseAiConsent(raw: String?): AiConsentRecord {
    val text = raw?.trim().orEmpty()
    val separator = text.indexOf(':')
    if (separator <= 0 || separator == text.lastIndex) return AiConsentRecord(AiConsentDecision.NONE, 0)
    val decision = AiConsentDecision.fromWire(text.substring(0, separator))
    if (decision == AiConsentDecision.NONE) return AiConsentRecord(AiConsentDecision.NONE, 0)
    val version = text.substring(separator + 1).toIntOrNull() ?: return AiConsentRecord(AiConsentDecision.NONE, 0)
    return AiConsentRecord(decision, version)
}

fun encodeAiConsent(decision: AiConsentDecision, version: Int = AI_CONSENT_VERSION): String {
    require(decision != AiConsentDecision.NONE) { "aucune décision à enregistrer" }
    require(version > 0) { "version invalide" }
    return "${decision.wire}:$version"
}

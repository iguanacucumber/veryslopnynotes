package fr.veryslopnynotes.core

// Consentement de premier usage de l'assistant IA (PRV-04) et attestation
// d'âge ou d'autorisation parentale (PRV-05). Fichier PUR : la version, la
// décision, l'attestation et la lecture d'un enregistrement sont exécutées par
// la parité, sans Android. Le stockage vit dans `data/AiConsentStore.kt`.

/**
 * Version du texte, du périmètre ET de l'attestation acceptés. À incrémenter
 * pour tout changement MATÉRIEL : catégorie de données ajoutée ou retirée,
 * destinataire ou règle de conservation modifiée, usage élargi, attestation
 * ajoutée ou modifiée. Une reformulation sans effet sur les données ne change
 * pas la version. Une version inconnue = refus.
 */
const val AI_CONSENT_VERSION = 3

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

/**
 * L'attestation est enregistrée avec la décision : elle n'est jamais déduite
 * d'une case à cocher volatile. Absente ou illisible = `false`.
 */
data class AiConsentRecord(
    val decision: AiConsentDecision,
    val version: Int,
    val ageAttested: Boolean = false,
) {
    /** Seul un accord attesté à la version courante autorise un appel IA. */
    val allowsAi: Boolean
        get() = decision == AiConsentDecision.GRANTED &&
            version == AI_CONSENT_VERSION &&
            ageAttested

    /** Un accord d'une autre version ou sans attestation doit être redemandé. */
    val needsReconsent: Boolean
        get() = decision == AiConsentDecision.GRANTED &&
            (version != AI_CONSENT_VERSION || !ageAttested)
}

private const val ATTESTATION_NONE = "none"
private const val ATTESTATION_GIVEN = "attested"

/** Enregistrement illisible, inconnu, non attesté ou d'une autre version = aucun accord. */
fun parseAiConsent(raw: String?): AiConsentRecord {
    val text = raw?.trim().orEmpty()
    val parts = text.split(':')
    if (parts.size !in 2..3 || parts[0].isEmpty() || parts[1].isEmpty()) {
        return AiConsentRecord(AiConsentDecision.NONE, 0)
    }
    val decision = AiConsentDecision.fromWire(parts[0])
    if (decision == AiConsentDecision.NONE) return AiConsentRecord(AiConsentDecision.NONE, 0)
    val version = parts[1].toIntOrNull() ?: return AiConsentRecord(AiConsentDecision.NONE, 0)
    if (version <= 0) return AiConsentRecord(AiConsentDecision.NONE, 0)
    // Ancien format à deux champs (`granted:1`) : lisible, mais jamais attesté.
    val ageAttested = when (parts.getOrNull(2)) {
        null, ATTESTATION_NONE -> false
        ATTESTATION_GIVEN -> true
        else -> return AiConsentRecord(AiConsentDecision.NONE, 0)
    }
    return AiConsentRecord(
        decision,
        version,
        ageAttested = decision == AiConsentDecision.GRANTED && ageAttested,
    )
}

fun encodeAiConsent(
    decision: AiConsentDecision,
    version: Int = AI_CONSENT_VERSION,
    ageAttested: Boolean = false,
): String {
    require(decision != AiConsentDecision.NONE) { "aucune décision à enregistrer" }
    require(version > 0) { "version invalide" }
    // Un accord sans attestation ne doit jamais être écrit : le stockage ne
    // peut pas fabriquer un état que l'écran n'a pas recueilli.
    require(decision != AiConsentDecision.GRANTED || ageAttested) { "attestation requise" }
    val attestation = if (decision == AiConsentDecision.GRANTED) ATTESTATION_GIVEN else ATTESTATION_NONE
    return "${decision.wire}:$version:$attestation"
}

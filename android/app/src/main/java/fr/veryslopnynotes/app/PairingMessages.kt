package fr.veryslopnynotes.app

/**
 * Messages d'appairage choisis PAR LE PONT (#396).
 *
 * L'appairage traverse la frontière native/JS : ce qui sort du pont ne peut
 * être qu'une phrase bornée. La couche `data` ne renvoie donc qu'un CODE
 * d'échec — un message d'exception peut nommer l'hôte de l'établissement
 * (adresse interne, port) et ce texte ne franchit JAMAIS le pont (I10).
 *
 * Chaque code a ici SA phrase : pas d'hôte, pas d'IP, pas de nom de compte,
 * pas de détail d'infrastructure. Le code suffit à l'interface web, qui
 * reformule le geste à faire (`web/src/features/pairing/model.ts`).
 */
private val PAIRING_MESSAGES: Map<String, String> = mapOf(
    "bad_request" to "Appairage refusé : vérifie le QR et le PIN, puis rescane si besoin.",
    "qr_rejected" to "QR ou PIN refusé par l'établissement : rescane le code affiché par son application.",
    "mfa_required" to "Ce compte exige une vérification supplémentaire que l'app ne prend pas en charge.",
    "login_refused" to "Compte refusé par l'établissement : régénère le QR dans son application, puis rescane-le.",
    "school_unreachable" to "L'établissement ne répond pas : réessaie dans un instant.",
    "network" to "Réseau indisponible : vérifie ta connexion, puis réessaie.",
    // Connexion à l'établissement de DÉMONSTRATION : le compte est public, le
    // geste est « réessaie » — jamais « rescane le QR ».
    "demo_failed" to "Connexion à la démo impossible : l'établissement de démonstration ne répond pas. Réessaie dans un instant.",
    "internal" to "Session illisible : réessaie l'appairage.",
)

/** Repli : un code inconnu ne dit rien de l'infrastructure. */
private const val PAIRING_FALLBACK = "Appairage impossible : rescane le QR puis réessaie."

/**
 * Phrase d'appairage pour un code d'échec, choisie par le pont.
 *
 * @param code code d'échec de `PairingResult.Err` (jamais un message brut).
 * @return une phrase bornée : ni hôte, ni IP, ni nom de compte.
 */
fun pairingFailureMessage(code: String): String =
    PAIRING_MESSAGES[code] ?: PAIRING_FALLBACK

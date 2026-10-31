package fr.veryslopnynotes.app

/**
 * Un message d'exception peut nommer l'hôte de l'établissement (adresse
 * interne, port) : chaque code a ici SA phrase, qui ne franchit jamais le pont
 * avec un hôte, une IP ou un nom de compte (I10).
 */
private val PAIRING_MESSAGES: Map<String, String> = mapOf(
    "bad_request" to "Appairage refusé : vérifie le QR et le PIN, puis rescane si besoin.",
    "qr_rejected" to "QR ou PIN refusé par l'établissement : rescane le code affiché par son application.",
    "mfa_required" to "Ce compte exige une vérification supplémentaire que l'app ne prend pas en charge.",
    "login_refused" to "Compte refusé par l'établissement : régénère le QR dans son application, puis rescane-le.",
    "rate_limited" to "L'établissement limite les connexions : attends une ou deux minutes, puis réessaie.",
    "school_unreachable" to "L'établissement ne répond pas : réessaie dans un instant.",
    "network" to "Réseau indisponible : vérifie ta connexion, puis réessaie.",
    // Établissement de DÉMONSTRATION : le geste est « réessaie », jamais « rescane ».
    "demo_failed" to "Connexion à la démo impossible : l'établissement de démonstration ne répond pas. Réessaie dans un instant.",
    "internal" to "Session illisible : réessaie l'appairage.",
)

/** Repli : un code inconnu ne dit rien de l'infrastructure. */
private const val PAIRING_FALLBACK = "Appairage impossible : rescane le QR puis réessaie."

/** Phrase bornée : ni hôte, ni IP, ni nom de compte. */
fun pairingFailureMessage(code: String): String =
    PAIRING_MESSAGES[code] ?: PAIRING_FALLBACK

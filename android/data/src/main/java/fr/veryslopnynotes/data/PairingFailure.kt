package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.ExpiredObject
import fr.veryslopnynotes.pronote.IpSuspendedError
import fr.veryslopnynotes.pronote.MFAError
import fr.veryslopnynotes.pronote.PronoteAPIError
import fr.veryslopnynotes.pronote.QRCodeDecryptError
import fr.veryslopnynotes.pronote.RateLimitedError
import fr.veryslopnynotes.pronote.UnexpectedPageError
import java.io.IOException

/**
 * Cause typée d'un échec d'appairage. Le CODE est le contrat du pont ; la
 * PHRASE est ici pour la couche `data`, et l'UI en tient une copie bornée.
 *
 * Aucune branche ne lit le message d'une exception : il peut nommer l'hôte,
 * une IP ou un compte (I10). Le TYPE porte la cause.
 */
enum class PairingFailureCause(val code: String, val message: String) {
    NETWORK("network", "Réseau indisponible : vérifie ta connexion, puis réessaie."),
    RATE_LIMITED("rate_limited", "L'établissement limite les connexions : attends une ou deux minutes, puis réessaie."),
    QR_REJECTED("qr_rejected", "QR ou PIN refusé par l'établissement : rescane le code affiché par son application."),
    MFA_REQUIRED("mfa_required", "Ce compte exige une vérification supplémentaire que l'app ne prend pas en charge."),
    IP_SUSPENDED("ip_suspended", "L'établissement bloque l'accès depuis ce réseau : change de réseau (Wi-Fi ou données), puis réessaie."),
    UNEXPECTED_PAGE("unexpected_page", "L'adresse du QR ne mène pas à l'établissement : régénère le QR dans son application, puis rescane-le."),
    LOGIN_REFUSED("login_refused", "Compte refusé par l'établissement : régénère le QR dans son application, puis rescane-le."),
    SCHOOL_UNREACHABLE("school_unreachable", "L'établissement ne répond pas : réessaie dans un instant."),
}

/**
 * `G` présent = refus applicatif ; `ExpiredObject` (G=22) est un jeton d'une
 * session précédente, donc à réappairer. Un `PronoteAPIError` sans code ni 401
 * (page inattendue, enveloppe illisible) n'affirme pas un refus de compte.
 */
fun pairingFailureCause(e: Throwable): PairingFailureCause = when {
    e is IOException -> PairingFailureCause.NETWORK
    e is RateLimitedError -> PairingFailureCause.RATE_LIMITED
    e is QRCodeDecryptError -> PairingFailureCause.QR_REJECTED
    e is MFAError -> PairingFailureCause.MFA_REQUIRED
    e is IpSuspendedError -> PairingFailureCause.IP_SUSPENDED
    e is UnexpectedPageError -> PairingFailureCause.UNEXPECTED_PAGE
    e is ExpiredObject -> PairingFailureCause.LOGIN_REFUSED
    e is PronoteAPIError && e.pronoteErrorCode != null -> PairingFailureCause.LOGIN_REFUSED
    e is PronoteAPIError && e.httpStatus == 401 -> PairingFailureCause.LOGIN_REFUSED
    else -> PairingFailureCause.SCHOOL_UNREACHABLE
}

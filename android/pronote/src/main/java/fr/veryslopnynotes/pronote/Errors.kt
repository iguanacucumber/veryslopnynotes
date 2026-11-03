package fr.veryslopnynotes.pronote

/**
 * Le NOM des classes fait partie du contrat : les tests comparent `name`, et le
 * client branche dessus. `ExpiredObject` est un `PronoteAPIError` (comme la
 * référence) : `catch (e: PronoteAPIError)` attrape le cas « session précédente ».
 */
open class CryptoError(message: String) : PronoteAPIError(message)

open class PronoteAPIError(
    message: String,
    val pronoteErrorCode: Int? = null,
    val pronoteErrorMsg: String? = null,
    /**
     * Statut HTTP refusé (401 = jeton plus accepté), `null` si l'échec n'est
     * pas HTTP. CHAMP et non mot du message : « session morte » s'y fie.
     */
    val httpStatus: Int? = null,
    /** `Retry-After` de la réponse (ms), plancheur du réessai ; `null` = absent. */
    val retryAfterMs: Long? = null,
) : Exception(message)

class ExpiredObject(message: String) : PronoteAPIError(message)

/**
 * Pièce jointe refusée AVANT tout réseau : adresse hors origine de
 * l'établissement, lien `type == 0`, ou corps qui n'est pas un fichier.
 * Le message ne porte jamais l'adresse refusée (elle peut contenir la session).
 */
class AttachmentRefused(message: String) : PronoteAPIError(message)

/** Téléchargement refusé par le statut HTTP ; le corps d'erreur n'est jamais lu. */
class AttachmentHttpError(message: String, httpStatus: Int) : PronoteAPIError(message, httpStatus = httpStatus)

/**
 * L'établissement a suspendu l'accès depuis ce réseau. Ce n'est ni un compte
 * refusé ni une panne de l'établissement : le geste est de changer de réseau.
 */
class IpSuspendedError(message: String = "Your IP address is suspended.") : PronoteAPIError(message)

/** Page HTML sans `Start({…})` : l'URL ne mène pas à Pronote. */
class UnexpectedPageError(message: String) : PronoteAPIError(message)

/**
 * Type à part : le client ne doit PAS rafraîchir la session pour ce cas — un
 * refresh = un nouveau login = encore plus de requêtes, donc plus de limitation.
 * `pronoteErrorCode` = 25 si `Erreur.G`, `httpStatus` = 429 si refus HTTP ; les
 * deux peuvent être nuls si levée localement par [RateLimitGate].
 */
class RateLimitedError(
    message: String = "[ERROR 25] Exceeded max authorization requests. Please wait before retrying...",
    pronoteErrorCode: Int? = 25,
    pronoteErrorMsg: String? = null,
    httpStatus: Int? = null,
    /** `Retry-After` de la réponse : plancher du cooldown, `null` si absent. */
    retryAfterMs: Long? = null,
) : PronoteAPIError(message, pronoteErrorCode, pronoteErrorMsg, httpStatus, retryAfterMs)

/** Les refus applicatifs sont branchés par NOM, comme côté TS (jamais importés). */
open class DataError(message: String) : Exception(message)

class ParsingError(message: String, val path: List<String> = emptyList()) : DataError(message)

class DateParsingError(val dateString: String) : PronoteAPIError("Could not parse date")

class DiscussionClosed(message: String = "Discussion is closed") : PronoteAPIError(message)

class UnsupportedOperation(message: String = "Unsupported operation") : PronoteAPIError(message)

class QRCodeDecryptError(message: String) : CryptoError(message)

class MFAError(message: String) : PronoteAPIError(message)

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
) : Exception(message)

class ExpiredObject(message: String) : PronoteAPIError(message)

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
) : PronoteAPIError(message, pronoteErrorCode, pronoteErrorMsg, httpStatus)

/** Les refus applicatifs sont branchés par NOM, comme côté TS (jamais importés). */
open class DataError(message: String) : Exception(message)

class ParsingError(message: String, val path: List<String> = emptyList()) : DataError(message)

class DateParsingError(val dateString: String) : PronoteAPIError("Could not parse date")

class DiscussionClosed(message: String = "Discussion is closed") : PronoteAPIError(message)

class UnsupportedOperation(message: String = "Unsupported operation") : PronoteAPIError(message)

class QRCodeDecryptError(message: String) : CryptoError(message)

class MFAError(message: String) : PronoteAPIError(message)

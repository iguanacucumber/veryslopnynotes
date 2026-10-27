package fr.veryslopnynotes.pronote

/**
 * Erreurs du protocole (#200, miroir de `pronotets` `exceptions.js`).
 *
 * Le NOM des classes fait partie du contrat : les tests comparent `name`
 * (`e.name == "PronoteAPIError"`), et le client (#201) branchera dessus.
 * - `CryptoError` : déchiffrement AES impossible (mauvaise clé/IV) ;
 * - `PronoteAPIError` : refus du serveur (`Erreur.G`, message `Titre`) ou HTTP
 *   non-OK — `pronoteErrorCode`/`pronoteErrorMsg` portent le détail brut ;
 * - `ExpiredObject` : `G == 22`, l'objet vient d'une session précédente.
 *
 * HÉRITAGE : `ExpiredObject` est un `PronoteAPIError` (comme la référence) —
 * un `catch (e: PronoteAPIError)`, le contrat documenté, attrape donc le cas
 * « objet d'une session précédente » au lieu de le laisser filer.
 */
open class CryptoError(message: String) : PronoteAPIError(message)

open class PronoteAPIError(
    message: String,
    val pronoteErrorCode: Int? = null,
    val pronoteErrorMsg: String? = null,
    /**
     * Statut HTTP de la réponse refusée (401 = le jeton n'est plus accepté),
     * `null` quand l'échec n'est pas HTTP (une erreur `G` de l'établissement,
     * une enveloppe illisible).
     *
     * C'est un CHAMP, pas un mot du message : la décision « session morte »
     * s'y fie (#520). Le NOM de la classe reste `PronoteAPIError` — c'est le
     * contrat avec la référence TS (les tests comparent `name`).
     */
    val httpStatus: Int? = null,
) : Exception(message)

class ExpiredObject(message: String) : PronoteAPIError(message)

/**
 * Limitation de débit de l'établissement (`G == 25` ou HTTP 429).
 *
 * C'est un `PronoteAPIError` (les appelants qui attrapent la famille restent
 * corrects), mais un TYPE à part : le client ne doit PAS rafraîchir la session
 * pour ce cas. Un refresh = un nouveau login = encore plus de requêtes
 * d'authentification, donc encore plus de limitation.
 *
 * `pronoteErrorCode` vaut 25 quand l'établissement a répondu `Erreur.G` ;
 * `httpStatus` vaut 429 quand le refus est HTTP. Les deux peuvent être nuls
 * pour une erreur levée localement par [RateLimitGate].
 */
class RateLimitedError(
    message: String = "[ERROR 25] Exceeded max authorization requests. Please wait before retrying...",
    pronoteErrorCode: Int? = 25,
    pronoteErrorMsg: String? = null,
    httpStatus: Int? = null,
) : PronoteAPIError(message, pronoteErrorCode, pronoteErrorMsg, httpStatus)

/**
 * Erreurs de lecture du JSON PRONOTE (#201, miroir de `exceptions.js`).
 * - `DataError` : enveloppe inattendue (fils de `Error` nu, pas de code) ;
 * - `ParsingError` : chemin introuvable ou conversion impossible ;
 * - `DateParsingError` : date FR illisible ;
 * - `DiscussionClosed`, `UnsupportedOperation`, `QRCodeDecryptError`, `MFAError` :
 *   refus applicatifs branchés par nom (comme côté TS, jamais importés).
 */
open class DataError(message: String) : Exception(message)

class ParsingError(message: String, val path: List<String> = emptyList()) : DataError(message)

class DateParsingError(val dateString: String) : PronoteAPIError("Could not parse date")

class DiscussionClosed(message: String = "Discussion is closed") : PronoteAPIError(message)

class UnsupportedOperation(message: String = "Unsupported operation") : PronoteAPIError(message)

class QRCodeDecryptError(message: String) : CryptoError(message)

class MFAError(message: String) : PronoteAPIError(message)

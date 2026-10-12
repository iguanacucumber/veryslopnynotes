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
 */
open class CryptoError(message: String) : PronoteAPIError(message)

open class PronoteAPIError(
    message: String,
    val pronoteErrorCode: Int? = null,
    val pronoteErrorMsg: String? = null,
) : Exception(message)

class ExpiredObject(message: String) : Exception(message)

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

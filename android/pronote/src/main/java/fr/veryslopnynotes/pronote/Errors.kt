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
class CryptoError(message: String) : PronoteAPIError(message)

open class PronoteAPIError(
    message: String,
    val pronoteErrorCode: Int? = null,
    val pronoteErrorMsg: String? = null,
) : Exception(message)

class ExpiredObject(message: String) : Exception(message)

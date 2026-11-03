package fr.veryslopnynotes.app

// Autorité FileProvider dérivée de l'`applicationId` et message « aucun
// ouvreur » : fichier PUR (aucun import `android.*`), compilé par la parité.
// Le manifeste déclare `${applicationId}.fileprovider` ; les deux valeurs ne
// peuvent pas diverger sans que le build casse.

/** Autorité du FileProvider, identique au placeholder du manifeste. */
fun attachmentProviderAuthority(applicationId: String): String = "$applicationId.fileprovider"

/** Message rendu au JS quand `resolveActivity` ne trouve aucun ouvreur. */
const val NO_VIEWER_MESSAGE = "Aucune application ne peut ouvrir ce fichier."

/** `null` = un ouvreur est résolu ; sinon le refus explicite à remonter. */
fun viewerLaunchError(canResolve: Boolean): String? = if (canResolve) null else NO_VIEWER_MESSAGE

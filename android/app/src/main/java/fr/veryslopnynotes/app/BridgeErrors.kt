package fr.veryslopnynotes.app

// Ce qui sort du pont est un `{code, message}` borné, jamais le message brut
// d'une exception (il peut nommer un hôte, un compte, une URL).
// `Throwable` et non `Exception` : un `Error` non capturé tue le fil du worker
// sans `resolve` ni `reject`, et la promesse JS pend pour toujours.

class BridgeFailure(val code: String, message: String) : Exception(message)

/** Code de la table TS (`web/src/bridge/types.ts`) et phrase bornée affichée. */
data class BridgeError(val code: String, val message: String)

fun bridgeErrorFor(t: Throwable): BridgeError = when {
    t is BridgeFailure -> BridgeError(t.code, t.message ?: "Requête invalide.")
    // Mémoire épuisée : la cause est certaine, l'appel peut réussir plus tard.
    t is OutOfMemoryError -> BridgeError("unavailable", "Mémoire insuffisante sur l'appareil.")
    // Toute autre cause : on n'affirme rien.
    else -> BridgeError("unknown", "Erreur native.")
}

/**
 * Exécute l'action d'un appel du pont et traduit TOUT `Throwable` — donc aussi
 * un `Error` — en rejet borné. `null` : l'appel a réussi.
 */
fun bridgeCallOutcome(action: () -> Unit): BridgeError? = try {
    action()
    null
} catch (t: Throwable) {
    bridgeErrorFor(t)
}

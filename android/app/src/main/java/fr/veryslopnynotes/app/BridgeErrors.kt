package fr.veryslopnynotes.app

/**
 * Traduction d'un échec NATIF en REJET de pont (#394).
 *
 * Le pont traverse la frontière native/JS : ce qui sort ne peut être qu'un
 * couple `{code, message}` borné — jamais le message brut d'une exception (il
 * peut nommer un hôte, un compte, une URL).
 *
 * `Throwable` et non `Exception` : un `Error` (`OutOfMemoryError`,
 * `StackOverflowError`…) n'est PAS une `Exception`. Non capturé, il tue le
 * fil du worker SANS `resolve` ni `reject` : la promesse JS resterait
 * PENDANTE (elle n'expire pas pour `pairing.scanQr`, dont le délai est 0) et
 * l'interface bloquerait sur un chargement infini, sans message.
 *
 * Fichier PUR (aucun import) : il se compile SEUL, comme `PairingMessages.kt`
 * et `HomeworkMessages.kt` — le harnais de parité l'exécute.
 */

/**
 * Échec ATTENDU d'un appel du pont : le pont a choisi son code et sa phrase.
 *
 * La classe vivait dans `VsnBridge` (privée) ; elle est ici pour que la
 * traduction soit exécutée HORS Android, par le harnais de parité.
 */
class BridgeFailure(val code: String, message: String) : Exception(message)

/**
 * Rejet de pont : le code (table TS : `web/src/bridge/types.ts`) et la phrase
 * française bornée que l'UI affiche.
 */
data class BridgeError(val code: String, val message: String)

/**
 * Traduit un `Throwable` en rejet de pont.
 *
 * @param t l'échec natif.
 * @return un rejet borné : le message de `t` n'y est jamais recopié.
 */
fun bridgeErrorFor(t: Throwable): BridgeError = when {
    // Échec attendu : le pont a choisi son code et sa phrase.
    t is BridgeFailure -> BridgeError(t.code, t.message ?: "Requête invalide.")
    // Mémoire épuisée : la cause est certaine, l'appel peut réussir plus tard.
    t is OutOfMemoryError -> BridgeError("unavailable", "Mémoire insuffisante sur l'appareil.")
    // Toute autre cause : on n'affirme rien.
    else -> BridgeError("unknown", "Erreur native.")
}

/**
 * Exécute l'action d'un appel du pont et traduit TOUT `Throwable` — donc
 * aussi un `Error` — en rejet borné. `null` : l'appel a réussi.
 *
 * Le filet du pont : rien ne sort du fil du worker, jamais. Sans lui, un
 * `Error` tue le fil SANS réponse et la promesse JS pend (#394).
 */
fun bridgeCallOutcome(action: () -> Unit): BridgeError? = try {
    action()
    null
} catch (t: Throwable) {
    bridgeErrorFor(t)
}

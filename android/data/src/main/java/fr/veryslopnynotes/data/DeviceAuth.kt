package fr.veryslopnynotes.data

// Signal unique « session Pronote morte » (#113, repointé #206 : device-only).
// Le garde-fou n'est plus un intercepteur HTTP (plus de bearer serveur —
// `ApiClient` supprimé) : ce sont les dépôts locaux qui lèvent le signal quand
// le client du téléphone échoue en `isSessionFailure` (jeton tourné, session
// refermée côté établissement). L'UI répare par le chemin EXISTANT
// `accounts.logout()` puis renvoie à l'appairage.
//
// #397 : le signal a enfin un ABONNÉ — l'app (le pont), branché UNE fois au
// démarrage. Il répare par le chemin EXISTANT : `accounts.logout()` — session
// invalidée ET cache purgé (`SessionRepair.purge`, cf. #407) — puis l'interface
// renvoie vers l'appairage. Avant, `reject()` ne purgeait rien : le natif
// gardait le jeton mort et servait un cache périmé comme frais.
//
// Anti-boucle : après `logout()` il n'y a plus de session (`PronoteSession`
// purgée, store vidé), donc plus aucun dépôt ne peut lever le signal ; et la
// purge ne lève jamais le signal elle-même.
// ponytail: un seul listener, pas de bus d'événements. Upgrade: `StateFlow` si
// plusieurs écrans doivent observer la session.
object DeviceAuth {
    /**
     * UNE seule formulation pour toute session morte : l'app ne devine pas de
     * cause (jeton tourné / session refermée / compte régénéré sont
     * INDISTINGUABLES côté client), donc ni cause devinée ni compte à rebours.
     */
    const val REJECTED_MESSAGE = "Session refusée par l'établissement : ré-appairez l'appareil (QR + PIN)."

    @Volatile
    private var onRejected: (() -> Unit)? = null

    /** Abonne l'UI ; `null` désabonne (écran détruit). */
    fun setOnRejected(listener: (() -> Unit)?) {
        onRejected = listener
    }

    /** Interne : seuls les dépôts lèvent le signal (jamais l'UI, jamais une piste). */
    internal fun reject() {
        // Le signal ne doit JAMAIS faire échouer celui qui le lève : le dépôt
        // doit pouvoir renvoyer son refus. Sans ce filet, une purge en échec
        // traverserait la file de lecture (ou le `Thread` du dépôt) et tuerait
        // son fil — la promesse JS pendrait jusqu'au délai.
        try {
            onRejected?.invoke()
        } catch (_: Exception) {
        }
    }
}

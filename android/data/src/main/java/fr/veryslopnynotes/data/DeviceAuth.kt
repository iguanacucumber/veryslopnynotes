package fr.veryslopnynotes.data

// Signal unique « session Pronote morte » : les dépôts locaux le lèvent quand
// le client du téléphone échoue en `isSessionFailure`. L'UI répare par le
// chemin existant `accounts.logout()` (session invalidée + cache purgé), puis
// renvoie à l'appairage.
//
// Anti-boucle : après `logout()` il n'y a plus de session (PronoteSession
// purgée, store vidé), donc plus aucun dépôt ne peut lever le signal ; et la
// purge ne lève jamais le signal elle-même.
// ponytail: un seul listener, pas de bus d'événements. Upgrade: `StateFlow` si
// plusieurs écrans doivent observer la session.
object DeviceAuth {
    /**
     * Une seule formulation pour toute session morte : la cause (jeton tourné,
     * session refermée, compte régénéré) est indistinguable côté client.
     */
    const val REJECTED_MESSAGE = "Session refusée par l'établissement : ré-appairez l'appareil (QR + PIN)."

    @Volatile
    private var onRejected: (() -> Unit)? = null

    fun setOnRejected(listener: (() -> Unit)?) {
        onRejected = listener
    }

    /** Seuls les dépôts lèvent le signal (jamais l'UI, jamais une piste). */
    internal fun reject() {
        // Le signal ne doit jamais faire échouer celui qui le lève : le dépôt
        // doit pouvoir renvoyer son refus. Sans ce filet, une purge en échec
        // tuerait son fil et la promesse JS pendrait jusqu'au délai.
        try {
            onRejected?.invoke()
        } catch (_: Exception) {
        }
    }
}

package fr.veryslopnynotes.app

import java.util.UUID

/**
 * QR scanné gardé côté natif (I10) : le JS ne reçoit qu'un handle opaque, un
 * login masqué et l'adresse affichable — jamais `login` ni `jeton`.
 * `pairing.pair` échange le handle contre le QR, donc le secret ne traverse pas
 * la WebView.
 *
 * Générique pour rester PUR : `SchoolQr` vit dans `data` (qui tire `org.json`),
 * or la parité TS ↔ Kotlin doit compiler et exécuter ce fichier.
 */
class QrHandle<T>(private val mint: () -> String = { UUID.randomUUID().toString() }) {
    private var pending: Entry<T>? = null

    /** Remplace le QR en attente : un nouveau scan invalide l'ancien handle. */
    @Synchronized
    fun remember(qr: T): String {
        val handle = mint()
        pending = Entry(handle, qr)
        return handle
    }

    /** Handle inconnu ou périmé = `null` (jamais un QR d'un autre scan). */
    @Synchronized
    fun lookup(handle: String): T? =
        pending?.takeIf { it.handle == handle && handle.isNotEmpty() }?.qr

    @Synchronized
    fun clear() {
        pending = null
    }

    private class Entry<T>(val handle: String, val qr: T)

    companion object {
        /** Longueur maximale d'un handle accepté du JS. */
        const val HANDLE_MAX_CHARS = 64
    }
}

/**
 * Login scanné masqué : assez pour reconnaître le compte visé, jamais la
 * valeur (elle déchiffre la session avec le PIN).
 */
fun maskLogin(login: String): String =
    if (login.length <= 2) "…" else login.take(2) + "…"

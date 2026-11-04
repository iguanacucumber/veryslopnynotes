package fr.veryslopnynotes.app

import java.security.MessageDigest

// Fichier PUR (`java.*` seulement) : le harnais de parité l'exécute.

private const val HEX = "0123456789ABCDEF"

/**
 * Empreinte SHA-256 d'un certificat DER, au format `AA:BB:…` (64 octets).
 * Identité PUBLIQUE de l'APK : cette valeur ne contient aucun secret.
 */
internal fun certificateSha256(der: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(der)
    return buildString(digest.size * 3 - 1) {
        digest.forEachIndexed { index, byte ->
            if (index > 0) append(':')
            val value = byte.toInt() and 0xFF
            append(HEX[value ushr 4])
            append(HEX[value and 0x0F])
        }
    }
}

package fr.veryslopnynotes.data

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.SocketTimeoutException

// Règles PURES du transport du fournisseur LLM : borne de lecture d'un corps
// et classement d'une panne réseau. Fichier `java.*` SEUL (ni OkHttp, ni
// `org.json`) : il est compilé et exécuté par la parité Kotlin, hors Gradle.
// Le protocole (URL, Bearer, statuts, non-rejeu) reste dans `OpenRouterLlm.kt`.

/**
 * Plafond de lecture d'une réponse fournisseur : 512 Kio.
 *
 * La sortie est DÉJÀ bornée à 12 000 caractères (I5) ; en JSON, un caractère
 * échappé en `\uXXXX` pèse 6 octets, soit ~72 Kio au pire. 512 Kio laissent
 * donc de la marge (métadonnées `usage`, enveloppe) tout en refusant un corps
 * qui n'est pas une réponse de chat — la mémoire de l'appareil reste bornée.
 */
const val MAX_RESPONSE_BYTES = 512 * 1024

/** Corps plus gros que [maxBytes] : refus explicite, jamais une lecture entière. */
class ResponseTooLargeException(val maxBytes: Int) : Exception("corps > $maxBytes octets")

/**
 * Lit [stream] en s'arrêtant dès que [maxBytes] est dépassé.
 *
 * Le flux n'est jamais vidé : on s'arrête au premier octet de trop, donc la
 * mémoire consommée reste [maxBytes] + un tampon. Un corps trop gros lève
 * [ResponseTooLargeException] plutôt que de remplir le tas.
 */
fun readBounded(stream: InputStream, maxBytes: Int = MAX_RESPONSE_BYTES): String {
    require(maxBytes > 0) { "maxBytes doit être positif" }
    val out = ByteArrayOutputStream(minOf(maxBytes, TAMPON_OCTETS))
    val buffer = ByteArray(TAMPON_OCTETS)
    var total = 0
    while (true) {
        val n = stream.read(buffer)
        if (n < 0) break
        total += n
        if (total > maxBytes) throw ResponseTooLargeException(maxBytes)
        out.write(buffer, 0, n)
    }
    return String(out.toByteArray(), Charsets.UTF_8)
}

/** Octets lus par `read` : borne la sur-lecture au-delà du plafond. */
private const val TAMPON_OCTETS = 8 * 1024

/** Panne de transport distinguée pour que l'élève sache quoi réessayer. */
enum class TransportFault { TIMEOUT, NETWORK }

/**
 * Classe une exception de transport : un DÉLAI (connect/read/call) n'a pas la
 * même cause qu'un réseau coupé ou un TLS refusé. La chaîne des `cause` est
 * suivie : OkHttp et la pile TLS enveloppent souvent l'originale.
 */
fun classifyTransportError(error: Throwable): TransportFault {
    var current: Throwable? = error
    while (current != null) {
        val cause = current
        if (cause is SocketTimeoutException) return TransportFault.TIMEOUT
        // `callTimeout` d'OkHttp lève un `InterruptedIOException("timeout")`,
        // pas un SocketTimeoutException : même cause, même message.
        if (cause is InterruptedIOException && cause.message?.contains("timeout", ignoreCase = true) == true) {
            return TransportFault.TIMEOUT
        }
        current = cause.cause
    }
    return TransportFault.NETWORK
}

/** Message affichable d'une panne de transport : borné, français, sans clé. */
fun transportFaultMessage(fault: TransportFault): String = when (fault) {
    TransportFault.TIMEOUT -> "Délai LLM dépassé : réessaie."
    TransportFault.NETWORK -> "Erreur réseau LLM : réessaie dans un instant."
}

/** Message d'un corps trop gros : nomme la LIMITE RÉELLE (I4), sans URL. */
fun responseTooLargeMessage(maxBytes: Int): String =
    "Réponse LLM trop volumineuse (max ${maxBytes / 1024} Kio) : réessaie."

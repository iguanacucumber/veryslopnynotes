package fr.veryslopnynotes.data

import org.json.JSONObject

// Appairage QR+PIN côté app (#15). Le serveur affiche un QR = payload
// {sessionId, code} (server/api/pairing.ts, contrat PairingStartResponse).
// L'app ne fait que lire ce payload + saisir le PIN : aucun secret en dur,
// aucune URL autre que l'allowlist serveur (voir PairingRepository).
// ponytail: pas de lib scan ici (champ texte = résultat scan). Upgrade:
// CameraX + MLKit barcode quand besoin, parseQrPayload inchangé.
data class QrPayload(
    val sessionId: String,
    val code: String,
)

private val PIN_RE = Regex("^[0-9]{6}$")

fun isValidPin(code: String): Boolean = PIN_RE.matches(code.trim())

fun parseQrPayload(raw: String): QrPayload? {
    val t = raw.trim()
    if (t.isEmpty()) return null
    if (t.startsWith("{")) {
        return try {
            val o = JSONObject(t)
            val sessionId = o.optString("sessionId", "").trim()
            val code = o.optString("code", "").trim()
            if (sessionId.isEmpty() || !isValidPin(code)) null else QrPayload(sessionId, code)
        } catch (_: Exception) {
            null
        }
    }
    // Fallback compact "sessionId|code" (copie manuelle si scan partiel).
    val sep = t.indexOf('|')
    if (sep > 0) {
        val sessionId = t.substring(0, sep).trim()
        val code = t.substring(sep + 1).trim()
        if (sessionId.isEmpty() || !isValidPin(code)) return null
        return QrPayload(sessionId, code)
    }
    return null
}

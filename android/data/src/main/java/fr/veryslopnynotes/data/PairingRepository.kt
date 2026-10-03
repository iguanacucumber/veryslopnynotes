package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ServerConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

// Appareil appairé (#15). `token` est le SECRET porteur des routes protégées :
// il ne se lit qu'ici (réponse d'appairage) et va droit dans le TokenStore
// chiffré. Classe simple et non `data class` VOLONTAIREMENT : le toString()
// généré par `data` ferait fuiter un bearer dans un log ou un rapport de crash.
// ponytail: pas de sérialisation ici (le secret ne se copie jamais ailleurs).
class PairedDevice(
    val id: String,
    val tokenHash: String,
    val token: String,
) {
    // Secret JAMAIS imprimé : ni crash, ni log, ni capture d'écran de debug.
    override fun toString(): String = "PairedDevice(id=$id, tokenHash=$tokenHash, token=***)"
}

sealed interface PairingResult {
    data class Ok(val device: PairedDevice) : PairingResult
    data class Err(val kind: String, val message: String) : PairingResult
}

// Dépôt appairage côté app (#15). Toute requête passe par ApiClient vers
// la allowlist serveur seule (ServerConfig). Aucun appel direct tiers ici.
// Les deux routes d'appairage construisent leur Request ici (et non via
// ApiClient.buildPost) : ce sont les seules où AUCUN bearer ne doit partir.
class PairingRepository(
    private val api: ApiClient,
) {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    fun startRequest(deviceName: String): Request {
        val body = JSONObject().put("deviceName", deviceName).toString().toRequestBody(jsonMedia)
        val url = ServerConfig.pairingStartUrl(api.baseUrl)
        require(ServerConfig.isAllowed(url, api.baseUrl)) { "URL hors allowlist serveur" }
        return Request.Builder().url(url).post(body).build()
    }

    fun confirmRequest(sessionId: String, code: String): Request {
        require(sessionId.isNotBlank()) { "sessionId vide" }
        require(isValidPin(code)) { "PIN invalide (6 chiffres attendus)" }
        val payload = JSONObject().put("sessionId", sessionId).put("code", code.trim()).toString()
            .toRequestBody(jsonMedia)
        val url = ServerConfig.pairingConfirmUrl(api.baseUrl)
        require(ServerConfig.isAllowed(url, api.baseUrl)) { "URL hors allowlist serveur" }
        return Request.Builder().url(url).post(payload).build()
    }

    fun parseStartResponse(json: String): QrPayload? {
        return try {
            val o = JSONObject(json)
            val sessionId = o.optString("sessionId", "").trim()
            val code = o.optString("code", "").trim()
            if (sessionId.isEmpty() || !isValidPin(code)) null else QrPayload(sessionId, code)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Réponse d'appairage 0.4.0 : `{ device: { id, tokenHash }, token }`.
     * Le secret ne sort QU'ici, une seule fois, à l'appairage. S'il est absent
     * ou incohérent avec son empreinte (tokenHash = sha256(token), contrat
     * `Device`), on renvoie `null` = échec BRUYANT (confirmBlocking → Err) :
     * mieux vaut un appairage raté qu'un credential stocké que l'app ne peut
     * jamais présenter (toutes les routes protégées répondraient 401).
     * La forme plate 0.3.0 (`{ id, tokenHash }`) n'est donc plus acceptée :
     * elle ne contient aucun secret exploitable.
     */
    fun parseConfirmResponse(json: String): PairedDevice? {
        return try {
            val o = JSONObject(json)
            val device = o.optJSONObject("device") ?: return null
            val id = device.optString("id", "").trim()
            val tokenHash = device.optString("tokenHash", "").trim()
            val token = o.optString("token", "").trim()
            if (id.isEmpty() || !TOKEN_HASH_RE.matches(tokenHash)) return null
            if (!isUsableToken(token)) return null
            // Intégrité : le secret doit être celui de l'empreinte annoncée,
            // sinon le serveur le refusera (verifyDeviceToken = sha256).
            if (sha256Hex(token) != tokenHash.lowercase()) return null
            PairedDevice(id, tokenHash, token)
        } catch (_: Exception) {
            null
        }
    }

    fun startBlocking(deviceName: String): PairingResult {
        if (deviceName.isBlank()) return PairingResult.Err("bad_request", "nom d'appareil vide")
        return try {
            api.client().newCall(startRequest(deviceName.trim())).execute().use { res ->
                val body = res.body?.string().orEmpty()
                if (!res.isSuccessful) return PairingResult.Err("http_${res.code}", body.take(200))
                val parsed = parseStartResponse(body)
                    ?: return PairingResult.Err("internal", "réponse appairage invalide")
                // start ne rend pas de device : on expose via QrPayload détourné.
                // L'appelant enchaîne confirm(sessionId, code) puis stocke le device.
                PairingResult.Err("need_confirm", "${parsed.sessionId}|${parsed.code}")
            }
        } catch (e: IOException) {
            PairingResult.Err("network", e.message ?: "réseau indisponible")
        }
    }

    fun confirmBlocking(sessionId: String, code: String): PairingResult {
        if (sessionId.isBlank() || !isValidPin(code)) {
            return PairingResult.Err("bad_request", "session ou PIN invalide")
        }
        return try {
            api.client().newCall(confirmRequest(sessionId, code)).execute().use { res ->
                val body = res.body?.string().orEmpty()
                if (!res.isSuccessful) return PairingResult.Err("http_${res.code}", body.take(200))
                val device = parseConfirmResponse(body)
                    ?: return PairingResult.Err("internal", "appairage incomplet : secret absent ou invalide")
                PairingResult.Ok(device)
            }
        } catch (e: IOException) {
            PairingResult.Err("network", e.message ?: "réseau indisponible")
        }
    }

    companion object {
        private val TOKEN_HASH_RE = Regex("^[0-9a-fA-F]{64}$")

        // Miroir de PAIRING_TOKEN_MAX_CHARS (shared/contracts/api.ts).
        private const val TOKEN_MAX_CHARS = 512

        private fun isUsableToken(token: String): Boolean =
            token.isNotEmpty() && token.length <= TOKEN_MAX_CHARS

        /** Empreinte hexadécimale minuscule du secret (32 octets = 64 chars). */
        private fun sha256Hex(value: String): String {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest(value.toByteArray(Charsets.UTF_8))
            val out = StringBuilder(64)
            for (b in digest) out.append(String.format(java.util.Locale.ROOT, "%02x", b.toInt() and 0xff))
            return out.toString()
        }
    }
}

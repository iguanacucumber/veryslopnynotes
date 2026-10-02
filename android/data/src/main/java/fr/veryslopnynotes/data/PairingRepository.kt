package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ServerConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

// Dépôt appairage côté app (#15). Toute requête passe par ApiClient vers
// la allowlist serveur seule (ServerConfig). Aucun appel direct tiers ici.
data class PairedDevice(
    val id: String,
    val tokenHash: String,
)

sealed interface PairingResult {
    data class Ok(val device: PairedDevice) : PairingResult
    data class Err(val kind: String, val message: String) : PairingResult
}

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

    fun parseConfirmResponse(json: String): PairedDevice? {
        return try {
            val o = JSONObject(json)
            val id = o.optString("id", "").trim()
            val tokenHash = o.optString("tokenHash", "").trim()
            if (id.isEmpty() || !TOKEN_HASH_RE.matches(tokenHash)) null
            else PairedDevice(id, tokenHash)
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
                    ?: return PairingResult.Err("internal", "réponse appareil invalide")
                PairingResult.Ok(device)
            }
        } catch (e: IOException) {
            PairingResult.Err("network", e.message ?: "réseau indisponible")
        }
    }

    companion object {
        private val TOKEN_HASH_RE = Regex("^[0-9a-fA-F]{64}$")
    }
}

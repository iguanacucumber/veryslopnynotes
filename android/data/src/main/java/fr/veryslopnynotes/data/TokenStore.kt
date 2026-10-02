package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// Stockage token sécurisé (#15). Seule l'empreinte tokenHash (hex sha256,
// contrat Device) est persistée, jamais de secret brut hors Keystore.
// EncryptedSharedPreferences (AES256) + fallback mémoire pour previews/tests.
// ponytail: pas de DataStore ici (une paire clé/valeur suffit). Upgrade:
// biométrie pour déverrouillage si besoin phase 10.
interface TokenStore {
    fun save(deviceId: String, tokenHash: String)
    fun deviceId(): String?
    fun tokenHash(): String?
    fun isPaired(): Boolean = deviceId() != null
    fun clear()
}

class EncryptedTokenStore(context: Context) : TokenStore {
    private val prefs: SharedPreferences by lazy {
        val appCtx = context.applicationContext
        try {
            val masterKey = MasterKey.Builder(appCtx)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                appCtx,
                PREFS,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (_: Exception) {
            // Fallback privé (chiffré OS) si Keystore indisponible en test.
            appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        }
    }

    override fun save(deviceId: String, tokenHash: String) {
        require(deviceId.isNotBlank()) { "deviceId vide" }
        require(TOKEN_HASH_RE.matches(tokenHash.trim())) { "tokenHash invalide" }
        prefs.edit()
            .putString(KEY_DEVICE_ID, deviceId.trim())
            .putString(KEY_TOKEN_HASH, tokenHash.trim())
            .apply()
    }

    override fun deviceId(): String? = prefs.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }

    override fun tokenHash(): String? = prefs.getString(KEY_TOKEN_HASH, null)?.takeIf { TOKEN_HASH_RE.matches(it) }

    override fun clear() {
        prefs.edit().remove(KEY_DEVICE_ID).remove(KEY_TOKEN_HASH).apply()
    }

    companion object {
        private const val PREFS = "pairing_tokens"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_TOKEN_HASH = "token_hash"
        private val TOKEN_HASH_RE = Regex("^[0-9a-fA-F]{64}$")
    }
}

// Secours mémoire (previews Compose, tests unitaires JVM sans Android).
class InMemoryTokenStore : TokenStore {
    private var deviceId: String? = null
    private var tokenHash: String? = null

    override fun save(deviceId: String, tokenHash: String) {
        this.deviceId = deviceId
        this.tokenHash = tokenHash
    }

    override fun deviceId(): String? = deviceId

    override fun tokenHash(): String? = tokenHash

    override fun clear() {
        deviceId = null
        tokenHash = null
    }
}

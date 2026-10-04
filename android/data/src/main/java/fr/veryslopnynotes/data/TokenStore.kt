package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// Bornes de session, une seule fois pour les DEUX implémentations (les faire
// diverger, c'est accepter un secret hors contrat ou refuser un secret valide).
// Miroir de PAIRING_TOKEN_MAX_CHARS (shared/contracts/api.ts).
private const val TOKEN_MAX_CHARS = 512
private val TOKEN_HASH_RE = Regex("^[0-9a-fA-F]{64}$")

// Stockage session appairée (#15, contrat 0.4.0). Deux secrets distincts :
// - l'empreinte `tokenHash` (hex sha256, contrat Device, publique côté API) ;
// - le SECRET `token` du device, bearer de toutes les routes protégées. Il ne
//   sort qu'une fois de la réponse d'appairage : il est donc persisté
//   CHIFFRÉ (EncryptedSharedPreferences AES256 + MasterKey), jamais en
//   SharedPreferences simple, jamais journalisé, jamais dans un toString(),
//   jamais dans un message d'erreur. Sans lui l'app ne peut s'authentifier
//   nulle part, donc on refuse d'écrire plutôt que d'enregistrer une
//   credential inutilisable (`require` = échec bruyant au moment du pairing).
// ponytail: pas de DataStore ici (deux paires clé/valeur suffisent). Upgrade:
// biométrie pour déverrouillage si besoin phase 10.
interface TokenStore {
    fun save(deviceId: String, tokenHash: String, token: String)
    fun deviceId(): String?
    fun tokenHash(): String?
    /** Secret porteur, relu À CHAQUE requête (jamais mis en cache en mémoire). */
    fun token(): String?
    /** Appairé = session complète (id + empreinte + secret) : sans secret, 401. */
    fun isPaired(): Boolean = deviceId() != null && token() != null
    fun clear()
}

/**
 * UN point de construction des preferences CHIFFREES pour tout le process
 * (bearer d'appareil, clé LLM) : MasterKey AES256-GCM + EncryptedSharedPrefs,
 * avec repli privé si le Keystore ne répond pas (previews, tests JVM).
 * Deux copies de ce bloc divergeraient (schéma de chiffrement différent entre le
 * jeton et la clé), donc une seule fonction, un seul schéma.
 * ponytail: repli `MODE_PRIVATE` non chiffré seulement quand le Keystore est
 * indisponible — un environnement de test n'a pas de hardware. Upgrade: refuser
 * d'écrire plutôt que d'écrire en clair si le Keystore manque sur un appareil.
 */
internal fun encryptedPrefs(context: Context, name: String): SharedPreferences {
    val appCtx = context.applicationContext
    return try {
        val masterKey = MasterKey.Builder(appCtx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appCtx,
            name,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (_: Exception) {
        appCtx.getSharedPreferences(name, Context.MODE_PRIVATE)
    }
}

class EncryptedTokenStore(context: Context) : TokenStore {
    private val prefs: SharedPreferences by lazy { encryptedPrefs(context, PREFS) }

    override fun save(deviceId: String, tokenHash: String, token: String) {
        require(deviceId.isNotBlank()) { "deviceId vide" }
        require(TOKEN_HASH_RE.matches(tokenHash.trim())) { "tokenHash invalide" }
        val secret = token.trim()
        // Messages d'erreur SANS le secret : un `require` peut finir dans un
        // rapport de crash, il ne doit rien révéler du bearer.
        require(secret.isNotEmpty()) { "token device vide" }
        require(secret.length <= TOKEN_MAX_CHARS) { "token device trop long" }
        prefs.edit()
            .putString(KEY_DEVICE_ID, deviceId.trim())
            .putString(KEY_TOKEN_HASH, tokenHash.trim())
            .putString(KEY_TOKEN, secret)
            .apply()
    }

    override fun deviceId(): String? = prefs.getString(KEY_DEVICE_ID, null)?.takeIf { it.isNotBlank() }

    override fun tokenHash(): String? = prefs.getString(KEY_TOKEN_HASH, null)?.takeIf { TOKEN_HASH_RE.matches(it) }

    override fun token(): String? =
        prefs.getString(KEY_TOKEN, null)?.takeIf { it.isNotEmpty() && it.length <= TOKEN_MAX_CHARS }

    // Déconnexion : PLUS AUCUNE trace de session, secret compris (le bearer
    // rejoué après un logout doit échouer). AccountStore.logout() appelle ici.
    override fun clear() {
        prefs.edit().remove(KEY_DEVICE_ID).remove(KEY_TOKEN_HASH).remove(KEY_TOKEN).apply()
    }

    companion object {
        private const val PREFS = "pairing_tokens"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_TOKEN_HASH = "token_hash"
        private const val KEY_TOKEN = "device_token"
    }
}

// Secours mémoire (previews Compose, tests unitaires JVM sans Android).
class InMemoryTokenStore : TokenStore {
    private var deviceId: String? = null
    private var tokenHash: String? = null
    private var token: String? = null

    override fun save(deviceId: String, tokenHash: String, token: String) {
        val secret = token.trim()
        require(deviceId.isNotBlank()) { "deviceId vide" }
        require(TOKEN_HASH_RE.matches(tokenHash.trim())) { "tokenHash invalide" }
        require(secret.isNotEmpty() && secret.length <= TOKEN_MAX_CHARS) { "token device invalide" }
        this.deviceId = deviceId.trim()
        this.tokenHash = tokenHash.trim()
        this.token = secret
    }

    override fun deviceId(): String? = deviceId

    override fun tokenHash(): String? = tokenHash

    override fun token(): String? = token

    override fun clear() {
        deviceId = null
        tokenHash = null
        token = null
    }
}

/**
 * UN store pour tout le process (activité, écran d'appairage, repositories) :
 * chiffré si le Keystore répond, mémoire sinon. Une seule instance, sinon deux
 * états divergents : un appairage réussi dans l'écran Appairage (store mémoire)
 * resterait invisible pour l'ApiClient du nav (autre store) et TOUTES les
 * routes protégées répondraient 401. Idem après `logout()` : le secret doit
 * disparaître partout d'un coup.
 * ponytail: double-checked locking sur un @Volatile, pas de framework de DI.
 */
object SessionTokens {
    @Volatile
    private var instance: TokenStore? = null

    fun get(context: Context): TokenStore {
        instance?.let { return it }
        return synchronized(this) {
            instance ?: newStore(context.applicationContext).also { instance = it }
        }
    }

    private fun newStore(context: Context): TokenStore = try {
        EncryptedTokenStore(context)
    } catch (_: Exception) {
        InMemoryTokenStore()
    }
}

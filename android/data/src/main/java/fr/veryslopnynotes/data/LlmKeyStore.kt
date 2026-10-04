package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import fr.veryslopnynotes.core.Homework

/**
 * Clé du fournisseur LLM de l'assistant devoirs (contrat 0.7.0).
 *
 * MÊME DISCIPLINE que le bearer d'appareil (TokenStore), parce que c'est la même
 * catégorie : un credential que l'APP détient et qui n'existe nulle part
 * ailleurs — le serveur ne lit aucun env, ne stocke rien (`server/infrastructure/http.ts`).
 * Donc : chiffré au repos (EncryptedSharedPreferences via [encryptedPrefs]),
 * jamais en SharedPreferences simple, jamais journalisé, jamais dans un
 * `toString()`, jamais dans un message d'erreur, jamais dans une URL. Lu à
 * CHAQUE requête, jamais mis en cache dans le dépôt (il change quand
 * l'utilisateur le réécrit) : même règle que le bearer.
 *
 * Elle n'est PAS effacée au logout : c'est la clé de l'utilisateur, pas une
 * session d'appareil. Un ré-appairage (serveur VPS changé) ne doit pas
 * obliger à payer une nouvelle saisie. Elle est effacée par [clear], donc par
 * « Oublier » dans les réglages et par la désinstallation.
 * ponytail: un fichier, une entrée, pas de rotation. Upgrade: plusieurs clés
 * (un fournisseur par matière) si le contrat gagne un `provider`.
 */
interface LlmKeyStore {
    fun save(apiKey: String)

    /** Secret porteur, relu À CHAQUE requête. `null` = clé absente. */
    fun apiKey(): String?

    /** Sans clé, l'app n'appelle pas le serveur : 400 refusé, inutile de payer l'aller-retour. */
    fun isConfigured(): Boolean = apiKey() != null

    fun clear()
}

class EncryptedLlmKeyStore(context: Context) : LlmKeyStore {
    private val prefs: SharedPreferences by lazy { encryptedPrefs(context, PREFS) }

    override fun save(apiKey: String) {
        val secret = apiKey.trim()
        // Messages SANS la clé : un `require` peut finir dans un rapport de crash.
        require(secret.isNotEmpty()) { "clé LLM vide" }
        require(secret.length <= Homework.MAX_API_KEY_CHARS) { "clé LLM trop longue" }
        prefs.edit().putString(KEY_API_KEY, secret).apply()
    }

    override fun apiKey(): String? =
        prefs.getString(KEY_API_KEY, null)
            ?.takeIf { it.isNotEmpty() && it.length <= Homework.MAX_API_KEY_CHARS }

    override fun clear() {
        prefs.edit().remove(KEY_API_KEY).apply()
    }

    companion object {
        private const val PREFS = "llm_keys"
        private const val KEY_API_KEY = "llm_api_key"
    }
}

// Secours mémoire (previews Compose, tests unitaires JVM sans Android) : même
// surface que EncryptedLlmKeyStore, donc les tests couvrent le même code.
class InMemoryLlmKeyStore : LlmKeyStore {
    private var key: String? = null

    override fun save(apiKey: String) {
        val secret = apiKey.trim()
        require(secret.isNotEmpty()) { "clé LLM vide" }
        require(secret.length <= Homework.MAX_API_KEY_CHARS) { "clé LLM trop longue" }
        key = secret
    }

    override fun apiKey(): String? = key

    override fun clear() {
        key = null
    }
}

/**
 * UN store pour tout le process (réglages, écran devoirs), comme
 * [SessionTokens] : deux instances = deux états divergents, et l'écran
 * Réglages pourrait afficher « clé configurée » alors que le dépôt en ignore
 * une autre.
 * ponytail: double-checked locking sur un @Volatile, pas de framework de DI.
 */
object LlmKeys {
    @Volatile
    private var instance: LlmKeyStore? = null

    fun get(context: Context): LlmKeyStore {
        instance?.let { return it }
        return synchronized(this) {
            instance ?: newStore(context.applicationContext).also { instance = it }
        }
    }

    private fun newStore(context: Context): LlmKeyStore = try {
        EncryptedLlmKeyStore(context)
    } catch (_: Exception) {
        InMemoryLlmKeyStore()
    }
}
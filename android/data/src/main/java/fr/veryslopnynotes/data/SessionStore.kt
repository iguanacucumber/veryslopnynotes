package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// Session Pronote locale (ADR-003) : ce que `Client.tokenLogin` doit
// reconstruire sans rescanner le QR — URL du client, login, jeton de connexion
// et identité de l'appareil.
//
// Le PIN du QR n'est JAMAIS persisté : il ne déchiffre `login` + `jeton` qu'à
// l'appairage. Ce qui dort ici est chiffré, borné, jamais journalisé, jamais
// dans un `toString()` ni un message d'erreur. Pas une `data class`
// VOLONTAIREMENT : le `toString()` généré ferait fuiter le jeton.
// ponytail: pas de sérialisation ici (le jeton ne se copie jamais ailleurs).
class StoredSession(
    val endpointUrl: String,
    val username: String,
    val password: String,
    val uuid: String,
    val clientIdentifier: String?,
    val schoolUrl: String,
    /** `JETON` (QR) ou `IDENTIFIANT` (démo) ; une session d'avant ce champ reste `JETON`. */
    val mode: String = SessionMode.JETON,
) {
    override fun toString(): String = "StoredSession(url=***, user=***)"
}

// Store de session Pronote : une session complète ou rien — sans jeton, l'app
// ne peut rien lire, donc on refuse d'écrire une session inutilisable.
interface SessionStore {
    fun save(session: StoredSession)
    fun load(): StoredSession?
    /** Appairé = session complète persistée (le client vit dans PronoteSession). */
    fun hasSession(): Boolean = load() != null
    fun clear()
}

/**
 * UN point de construction des préférences CHIFFRÉES du process (session,
 * clé LLM) : MasterKey AES256-GCM + EncryptedSharedPrefs. Deux copies
 * divergeraient (schéma de chiffrement différent) : une seule fonction.
 *
 * PLUS DE REPLI EN CLAIR : un Keystore indisponible levait un secret lisible
 * en `MODE_PRIVATE`. L'échec est BRUYANT (l'exception remonte) et les
 * singletons basculent sur le secours mémoire (session perdue au redémarrage =
 * ré-appairage, jamais un secret en clair). L'état dégradé est publié
 * (`SecureStorage`), donc l'app ne croit plus en silence ne pas être appairée.
 * ponytail: pas de DataStore ici (quelques paires clé/valeur suffisent).
 *
 * UNE seule MasterKey pour tout le process : sinon deux chargements Keystore
 * au démarrage. Alias et schéma identiques, construction paresseuse.
 */
private val masterKeyLock = Any()

@Volatile
private var sharedMasterKey: MasterKey? = null

internal fun encryptedPrefs(context: Context, name: String): SharedPreferences {
    val appCtx = context.applicationContext
    val masterKey = sharedMasterKey ?: synchronized(masterKeyLock) {
        sharedMasterKey ?: MasterKey.Builder(appCtx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build().also { sharedMasterKey = it }
    }
    return EncryptedSharedPreferences.create(
        appCtx,
        name,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
}

class EncryptedSessionStore(context: Context) : SessionStore {
    private val prefs: SharedPreferences by lazy { encryptedPrefs(context, PREFS) }

    override fun save(session: StoredSession) {
        // Messages d'erreur SANS secret : un `require` peut finir dans un
        // rapport de crash.
        require(isUsableUrl(session.endpointUrl)) { "session invalide" }
        require(isUsableSecret(session.username)) { "session invalide" }
        require(isUsableSecret(session.password)) { "session invalide" }
        require(session.uuid.isNotBlank() && session.uuid.length <= MAX_UUID_CHARS) { "session invalide" }
        require((session.clientIdentifier ?: "").length <= MAX_CLIENT_ID_CHARS) { "session invalide" }
        require(session.schoolUrl.trim().length <= MAX_SCHOOL_URL_CHARS) { "session invalide" }
        prefs.edit()
            .putString(KEY_URL, session.endpointUrl.trim())
            .putString(KEY_USERNAME, session.username)
            .putString(KEY_PASSWORD, session.password)
            .putString(KEY_UUID, session.uuid)
            .putString(KEY_CLIENT_ID, session.clientIdentifier ?: "")
            .putString(KEY_SCHOOL_URL, session.schoolUrl.trim())
            .putString(KEY_MODE, SessionMode.of(session.mode))
            .apply()
    }

    override fun load(): StoredSession? {
        val url = prefs.getString(KEY_URL, null)?.trim().orEmpty()
        val username = prefs.getString(KEY_USERNAME, null).orEmpty()
        val password = prefs.getString(KEY_PASSWORD, null).orEmpty()
        val uuid = prefs.getString(KEY_UUID, null).orEmpty()
        if (!isUsableUrl(url) || !isUsableSecret(username) || !isUsableSecret(password)) return null
        if (uuid.isBlank() || uuid.length > MAX_UUID_CHARS) return null
        return StoredSession(
            endpointUrl = url,
            username = username,
            password = password,
            uuid = uuid,
            clientIdentifier = prefs.getString(KEY_CLIENT_ID, null)?.takeIf { it.isNotEmpty() },
            schoolUrl = prefs.getString(KEY_SCHOOL_URL, null)?.trim().orEmpty(),
            mode = SessionMode.of(prefs.getString(KEY_MODE, null)),
        )
    }

    // Déconnexion : plus aucune trace de session, jeton compris (un jeton
    // rejoué après un logout doit échouer). AccountStore.logout() appelle ici.
    override fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREFS = "session"
        private const val KEY_URL = "endpoint_url"
        private const val KEY_USERNAME = "username"
        private const val KEY_PASSWORD = "jeton"
        private const val KEY_UUID = "uuid"
        private const val KEY_CLIENT_ID = "client_identifier"
        private const val KEY_SCHOOL_URL = "school_url"
        private const val KEY_MODE = "session_mode"

        private const val MAX_URL_CHARS = 2000
        private const val MAX_SECRET_CHARS = 4096
        private const val MAX_UUID_CHARS = 128
        private const val MAX_CLIENT_ID_CHARS = 512
        private const val MAX_SCHOOL_URL_CHARS = 300

        private fun isUsableUrl(url: String): Boolean =
            url.isNotBlank() && url.length <= MAX_URL_CHARS &&
                (url.startsWith("https://") || url.startsWith("http://"))

        private fun isUsableSecret(secret: String): Boolean =
            secret.isNotEmpty() && secret.length <= MAX_SECRET_CHARS
    }
}

// Secours mémoire (previews Compose, tests JVM, Keystore indisponible) : la
// session ne survit pas au redémarrage, et c'est le contrat — jamais un secret
// en clair sur disque.
class InMemorySessionStore : SessionStore {
    private var session: StoredSession? = null

    override fun save(session: StoredSession) {
        require(session.endpointUrl.isNotBlank()) { "session invalide" }
        require(session.username.isNotEmpty()) { "session invalide" }
        require(session.password.isNotEmpty()) { "session invalide" }
        require(session.uuid.isNotBlank()) { "session invalide" }
        this.session = session
    }

    override fun load(): StoredSession? = session

    override fun clear() {
        session = null
    }
}

/**
 * UN store pour tout le process : chiffré si le Keystore répond, mémoire sinon.
 * Une seule instance, sinon deux états divergents : un appairage réussi
 * resterait invisible, et après `logout()` le jeton survivrait quelque part.
 *
 * `hasSession()` force l'init paresseuse DANS le `try` : sans elle, un Keystore
 * KO ne jetterait qu'au premier usage réel, hors `try`, et le repli mémoire
 * n'aurait jamais lieu. L'état dégradé est publié, plus avalé en silence.
 * ponytail: double-checked locking sur un @Volatile, pas de framework de DI.
 */
object SessionStores {
    @Volatile
    private var instance: SessionStore? = null

    fun get(context: Context): SessionStore {
        instance?.let { return it }
        return synchronized(this) {
            instance ?: newStore(context.applicationContext).also { instance = it }
        }
    }

    private fun newStore(context: Context): SessionStore = try {
        EncryptedSessionStore(context).also { it.hasSession() }
    } catch (_: Exception) {
        // Repli mémoire (jamais un secret en clair), mais DIT : l'état dégradé
        // est publié et l'interface l'affiche.
        //
        // AUCUN journal ici : le store tient le jeton, la règle du dépôt est
        // « jamais de log à côté d'un secret ». Le diagnostic passe par l'ÉTAT.
        SecureStorage.markUnavailable()
        InMemorySessionStore()
    }
}

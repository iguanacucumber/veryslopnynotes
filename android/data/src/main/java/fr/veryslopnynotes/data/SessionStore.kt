package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// Session Pronote locale (#206, ADR-003) : ce que `Client.tokenLogin` doit
// reconstruire sans rescanner le QR — l'URL réécrite du client, le login, le
// jeton de connexion (tourné à l'appairage) et l'identité de l'appareil.
//
// Le PIN du QR n'est JAMAIS persisté : il ne sert qu'à déchiffrer `login` +
// `jeton` au moment de l'appairage (PairingRepository) et n'en sort jamais.
// Ce qui dort ici, c'est la SESSION qui en résulte — chiffrée, bornée,
// jamais journalisée, jamais dans un `toString()`, jamais dans un message
// d'erreur. Classe simple et non `data class` VOLONTAIREMENT : le `toString()`
// généré par `data` ferait fuiter le jeton dans un log ou un rapport de crash.
// ponytail: pas de sérialisation ici (le jeton ne se copie jamais ailleurs).
class StoredSession(
    val endpointUrl: String,
    val username: String,
    val password: String,
    val uuid: String,
    val clientIdentifier: String?,
    val schoolUrl: String,
    /**
     * Mode de réouverture (`SessionMode`) : `JETON` pour un appairage QR,
     * `IDENTIFIANT` pour l'établissement de démonstration. Une session
     * enregistrée avant ce mode n'a pas de valeur : elle reste `JETON`.
     */
    val mode: String = SessionMode.JETON,
) {
    // Secret JAMAIS imprimé : ni crash, ni log, ni capture d'écran de debug.
    override fun toString(): String = "StoredSession(url=***, user=***)"
}

// Store de session Pronote (#206 : TokenStore des jetons serveur supprimé).
// Une session complète ou rien : sans jeton, l'app ne peut rien lire, donc on
// refuse d'écrire plutôt que d'enregistrer une session inutilisable.
interface SessionStore {
    fun save(session: StoredSession)
    fun load(): StoredSession?
    /** Appairé = session complète persistée (le client vit dans PronoteSession). */
    fun hasSession(): Boolean = load() != null
    fun clear()
}

/**
 * UN point de construction des preferences CHIFFREES pour tout le process
 * (session Pronote, clé LLM) : MasterKey AES256-GCM + EncryptedSharedPrefs.
 * Deux copies de ce bloc divergeraient (schéma de chiffrement différent entre
 * la session et la clé), donc une seule fonction, un seul schéma.
 *
 * #206 : PLUS DE REPLI EN CLAIR. Avant, un Keystore indisponible écrivait le
 * jeton en `MODE_PRIVATE` lisible — un secret au repos en clair, silencieux.
 * Maintenant l'échec est BRUYANT (l'exception remonte) et les singletons
 * (`SessionStores`, `LlmKeys`) basculent sur le secours mémoire (session
 * perdue au redémarrage = ré-appairage, jamais un secret en clair).
 *
 * #401 : le repli mémoire est désormais SIGNALÉ : l'état dégradé est
 * publié (`SecureStorage` -> pont -> interface, qui le journalise). L'app ne
 * croit plus en silence ne pas être appairée, et la clé de l'assistant ne
 * disparaît plus sans explication.
 * ponytail: pas de DataStore ici (quelques paires clé/valeur suffisent).
 *
 * #249 : UNE seule MasterKey pour tout le process (session + clé LLM).
 * Avant, chaque `encryptedPrefs(name)` reconstruisait sa MasterKey
 * (Keystore IPC) : deux chargements Keystore au démarrage pour deux
 * fichiers. Le schéma/alias est identique, donc le partage est sûr ;
 * la construction reste paresseuse et le repli mémoire de #206 inchangé
 * (l'exception remonte, les singletons basculent).
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
        // rapport de crash, il ne doit rien révéler du jeton.
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
            // Une session enregistrée avant le mode de démonstration n'a pas
            // de valeur : elle se rouvre par son jeton, comme toujours.
            mode = SessionMode.of(prefs.getString(KEY_MODE, null)),
        )
    }

    // Déconnexion : PLUS AUCUNE trace de session, jeton compris (un jeton
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

// Secours mémoire (previews Compose, tests unitaires JVM sans Android,
// Keystore indisponible : la session ne survit pas au redémarrage, et c'est
// le contrat — jamais un secret en clair sur disque).
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
 * UN store pour tout le process (activité, écran d'appairage, repositories) :
 * chiffré si le Keystore répond, mémoire sinon. Une seule instance, sinon deux
 * états divergents : un appairage réussi dans l'écran resterait invisible pour
 * le reste de l'app, et après `logout()` le jeton survivrait quelque part.
 *
 * La sonde `hasSession()` force l'init paresseuse DANS le `try` : sans elle,
 * un Keystore KO ne jetterait qu'au premier usage réel (hors `try`), et le
 * repli mémoire n'aurait jamais lieu.
 *
 * #401 : le repli mémoire est SIGNALÉ, plus avalé en silence. L'échec est
 * publié (`SecureStorage` -> pont -> interface, qui le journalise) : l'app ne
 * croit plus en silence ne pas être appairée.
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
        // #401 : l'échec n'est PLUS SILENCIEUX. Le repli mémoire reste (jamais
        // un secret en clair), mais il est DIT : l'état dégradé est publié et
        // l'interface l'affiche.
        //
        // AUCUN journal ici : le store tient le jeton, la règle du dépôt est
        // « jamais de log à côté d'un secret » (cf. le pin sur
        // `SessionStore.kt`). Le diagnostic passe par l'ÉTAT, pas par un log.
        SecureStorage.markUnavailable()
        InMemorySessionStore()
    }
}

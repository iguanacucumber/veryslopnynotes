package fr.veryslopnynotes.data

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
// `save`/`clear` rendent l'issue du COMMIT : un échec disque n'est jamais un
// succès implicite (l'appairage ne doit pas croire la session persistée).
interface SessionStore {
    fun save(session: StoredSession): WriteResult
    fun load(): StoredSession?
    /** Appairé = session complète persistée (le client vit dans PronoteSession). */
    fun hasSession(): Boolean = load() != null
    fun clear(): WriteResult
}

/**
 * Session persistée : validation puis UN commit synchrone. Fichier PUR (aucun
 * import Android) : le harnais de parité le compile et injecte des pannes.
 */
class SessionRecordStore(private val store: KeyValueStore) : SessionStore {
    override fun save(session: StoredSession): WriteResult {
        if (!isUsableUrl(session.endpointUrl)) return WriteResult.Refused(INVALID)
        if (!isUsableSecret(session.username)) return WriteResult.Refused(INVALID)
        if (!isUsableSecret(session.password)) return WriteResult.Refused(INVALID)
        if (session.uuid.isBlank() || session.uuid.length > MAX_UUID_CHARS) {
            return WriteResult.Refused(INVALID)
        }
        if ((session.clientIdentifier ?: "").length > MAX_CLIENT_ID_CHARS) {
            return WriteResult.Refused(INVALID)
        }
        if (session.schoolUrl.trim().length > MAX_SCHOOL_URL_CHARS) return WriteResult.Refused(INVALID)
        val values = linkedMapOf(
            KEY_URL to session.endpointUrl.trim(),
            KEY_USERNAME to session.username,
            KEY_PASSWORD to session.password,
            KEY_UUID to session.uuid,
            KEY_CLIENT_ID to (session.clientIdentifier ?: ""),
            KEY_SCHOOL_URL to session.schoolUrl.trim(),
            KEY_MODE to SessionMode.of(session.mode),
        )
        return if (store.commit(values)) WriteResult.Written
        else WriteResult.Failed("session non enregistrée")
    }

    override fun load(): StoredSession? {
        val url = store.getString(KEY_URL)?.trim().orEmpty()
        val username = store.getString(KEY_USERNAME).orEmpty()
        val password = store.getString(KEY_PASSWORD).orEmpty()
        val uuid = store.getString(KEY_UUID).orEmpty()
        if (!isUsableUrl(url) || !isUsableSecret(username) || !isUsableSecret(password)) return null
        if (uuid.isBlank() || uuid.length > MAX_UUID_CHARS) return null
        return StoredSession(
            endpointUrl = url,
            username = username,
            password = password,
            uuid = uuid,
            clientIdentifier = store.getString(KEY_CLIENT_ID)?.takeIf { it.isNotEmpty() },
            schoolUrl = store.getString(KEY_SCHOOL_URL)?.trim().orEmpty(),
            mode = SessionMode.of(store.getString(KEY_MODE)),
        )
    }

    override fun clear(): WriteResult =
        if (store.clear()) WriteResult.Written else WriteResult.Failed("session non effacée")

    companion object {
        private const val INVALID = "session invalide"
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

/**
 * Bascule session + compte sous la MÊME garde d'époque : une déconnexion
 * concurrente invalide l'époque, donc la bascule est REFUSÉE avant d'écrire
 * (`EpochRefused`, rien de partiel).
 *
 * Si le compte est refusé APRÈS l'écriture de la session, la session PRÉCÉDENTE
 * est restaurée. Un échec de restauration est RENVOYÉ, jamais transformé en
 * succès qui laisserait le nouveau compte sans son entrée (ou l'inverse).
 *
 * ORDRE DES VERROUS : session -> époque -> store. L'appelant tient déjà la
 * section critique de session.
 */
class AccountSessionCommit(
    private val sessions: SessionStore,
    private val accounts: AccountRecorder,
) {
    fun switchTo(
        session: StoredSession,
        accountId: String?,
        observedEpoch: Long = SessionEpoch.current(),
    ): WriteResult = SessionEpoch.writeIfCurrent(observedEpoch) {
        val previous = try {
            sessions.load()
        } catch (_: Exception) {
            null
        }
        val saved = sessions.save(session)
        if (!saved.ok) return@writeIfCurrent saved
        if (accountId == null) return@writeIfCurrent saved
        val recorded = accounts.record(accountId)
        if (recorded.ok) return@writeIfCurrent recorded
        val restored = try {
            if (previous == null) sessions.clear() else sessions.save(previous)
        } catch (_: Exception) {
            WriteResult.Failed("session non restaurée")
        }
        if (restored.ok) recorded
        else WriteResult.Failed("bascule incomplète : session non restaurée")
    } ?: WriteResult.EpochRefused
}

package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

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

/**
 * Session chiffrée : la validation et le commit vivent dans [SessionRecordStore]
 * (fichier PUR, rejoué par la parité). Ici, seul le câblage Keystore.
 *
 * `save` ne dit « enregistré » qu'après un `commit()` synchrone : un appairage
 * ne peut plus réussir sur une écriture encore en vol, perdue au force-stop.
 */
class EncryptedSessionStore(context: Context) : SessionStore {
    private val context = context.applicationContext

    // Jetable : après un effacement dur, l'instance SharedPreferences garde ses
    // valeurs en mémoire. La relire rendrait la session qu'on vient d'effacer.
    @Volatile
    private var records: SessionRecordStore? = null

    private fun records(): SessionRecordStore =
        records ?: SessionRecordStore(SharedPrefsKeyValue(encryptedPrefs(context, PREFS)))
            .also { records = it }

    override fun save(session: StoredSession): WriteResult = records().save(session)

    override fun load(): StoredSession? = records().load()

    override fun loadOutcome(): SessionLoad = records().loadOutcome()

    override fun clear(): WriteResult {
        val cleared = try {
            records().clear().ok
        } catch (_: Exception) {
            false
        }
        // Un `clear()` de prefs laisse le fichier (et ses keysets) : la
        // suppression est l'effacement DUR, même quand le commit a échoué.
        val deleted = discardEncryptedSession(context)
        if (deleted) records = null
        return if (cleared || deleted) WriteResult.Written
        else WriteResult.Failed("session non effacée")
    }

    companion object {
        // Nom du fichier chiffré : la désinstallation l'emporte, `clear()` l'efface.
        internal const val PREFS = "session"
    }
}

/**
 * Efface le fichier chiffré SANS passer par le Keystore : illisible quand
 * celui-ci est mort, mais toujours présent sur le disque.
 *
 * Rend `true` seulement si le fichier a disparu (absent avant ou supprimé) :
 * un logout dégradé ne dit « déconnecté » que si l'ancienne session ne peut
 * plus revenir au prochain lancement sain.
 */
internal fun discardEncryptedSession(context: Context): Boolean {
    val app = context.applicationContext
    return try {
        app.deleteSharedPreferences(EncryptedSessionStore.PREFS) || erased(app)
    } catch (_: Exception) {
        erased(app)
    }
}

private fun erased(context: Context): Boolean = try {
    val dir = File(context.applicationInfo.dataDir, "shared_prefs")
    !File(dir, "${EncryptedSessionStore.PREFS}.xml").exists() &&
        !File(dir, "${EncryptedSessionStore.PREFS}.xml.bak").exists()
} catch (_: Exception) {
    false
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

    private fun newStore(context: Context): SessionStore {
        val secure = try {
            EncryptedSessionStore(context).also { it.hasSession() }
        } catch (_: Exception) {
            // Repli mémoire (jamais un secret en clair), mais DIT plus bas par
            // `ResilientSessionStore` : l'état dégradé est publié et l'interface
            // l'affiche.
            //
            // AUCUN journal ici : le store tient le jeton, la règle du dépôt est
            // « jamais de log à côté d'un secret ». Le diagnostic passe par l'ÉTAT.
            null
        }
        return ResilientSessionStore(secure) { discardEncryptedSession(context) }
    }
}

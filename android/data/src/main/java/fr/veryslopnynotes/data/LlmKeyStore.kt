package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences

// La clé du fournisseur LLM de l'assistant devoirs (contrat 0.7.0).
//
// ICI : le SEUL accès chiffré (EncryptedSharedPreferences via [encryptedPrefs])
// et le singleton de process. Le contrat `LlmKeyStore` et le repli mémoire
// vivent dans `LlmKeyFallback.kt` (fichier PUR, exécuté par la parité) : la
// règle « chiffré au repos, jamais en clair, jamais journalisé » y est la même
// que pour la session Pronote.
//
// Elle n'est PAS effacée au logout : c'est la clé de l'utilisateur, pas une
// session d'établissement. Un ré-appairage (nouveau QR) ne doit pas obliger à
// ressaisir la clé. Elle est effacée par [LlmKeyStore.clear], donc par
// « Oublier » dans les réglages et par la désinstallation.
// ponytail: un fichier, une entrée, pas de rotation. Upgrade: plusieurs clés
// (un fournisseur par matière) si le contrat gagne un `provider`.
class EncryptedLlmKeyStore(context: Context) : LlmKeyStore {
    private val prefs: SharedPreferences by lazy { encryptedPrefs(context, PREFS) }

    // `commit()`, PAS `apply()` : synchrone, il rend la main une fois l'écriture
    // sur disque, et il rend `false` en cas d'échec. `apply()` ne rendait pas
    // la main au disque : un force-stop juste après « clé enregistrée » la
    // perdait, et un force-stop juste après « Oublier » la LAISSAIT revenir au
    // lancement suivant — la résurrection que le repli doit empêcher.
    override fun save(apiKey: String) {
        // `false` = stockage en échec : on JETTE (message sans la clé). Le repli
        // dégrade alors vers la mémoire et efface le chiffré, donc l'ancienne
        // clé ne reste jamais l'autorité.
        check(prefs.edit().putString(KEY_API_KEY, validatedLlmKey(apiKey)).commit()) {
            "clé LLM non enregistrée"
        }
    }

    override fun apiKey(): String? =
        prefs.getString(KEY_API_KEY, null)?.takeIf { isValidLlmKey(it) }

    override fun clear() {
        // Même raison : sans `commit()`, l'effacement pouvait ne jamais
        // atteindre le disque. Un échec JETTE, et le repli passe alors par
        // l'effacement DUR du fichier (`discard`) : la clé ne ressuscite pas.
        check(prefs.edit().remove(KEY_API_KEY).commit()) { "clé LLM non effacée" }
    }

    companion object {
        /** Nom du fichier chiffré : [LlmKeys] l'efface sans le déchiffrer. */
        internal const val PREFS = "llm_keys"
        private const val KEY_API_KEY = "llm_api_key"
    }
}

/**
 * UN store pour tout le process (réglages, écran devoirs), comme
 * [SessionStores] : deux instances = deux états divergents, et l'écran
 * Réglages pourrait afficher « clé configurée » alors que le dépôt en ignore
 * une autre.
 *
 * La sonde `isConfigured()` force l'init paresseuse DANS le `try` : un
 * Keystore KO bascule sur le secours mémoire (clé perdue au redémarrage,
 * jamais écrite en clair — même contrat que la session, #206).
 *
 * #401 : ce repli est SIGNALÉ, jamais avalé en silence : l'état dégradé est
 * publié (`SecureStorage` -> pont -> interface, qui le journalise). La clé de
 * l'utilisateur ne disparaît plus sans explication.
 *
 * Le repli est un [ResilientLlmKeyStore] : un échec APRÈS l'init ne fait
 * plus jeter les appels, et « Oublier » efface AUSSI le fichier chiffré (sinon
 * la clé reviendrait au lancement suivant).
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

    private fun newStore(context: Context): LlmKeyStore {
        val secure: LlmKeyStore? = try {
            EncryptedLlmKeyStore(context).also { it.isConfigured() }
        } catch (_: Exception) {
            // AUCUN journal ici : le store tient la clé, la règle du dépôt est
            // « jamais de log à côté d'un secret ». L'état dégradé est marqué
            // par `ResilientLlmKeyStore` et publié par le pont.
            //
            // Le chiffré est ILLISIBLE, pas absent : sans effacement, une clé
            // oubliée/illisible ressusciterait au lancement suivant.
            runCatching { context.deleteSharedPreferences(EncryptedLlmKeyStore.PREFS) }
            null
        }
        return ResilientLlmKeyStore(secure) {
            // Effacement DURABLE du chiffré : le Keystore mort rend le fichier
            // ILLISIBLE, pas absent, donc son entrée survit à un `clear()`
            // mémoire. `deleteSharedPreferences` retire le fichier ET
            // l'instance en cache : la clé ne peut pas ressusciter.
            context.deleteSharedPreferences(EncryptedLlmKeyStore.PREFS)
        }
    }
}

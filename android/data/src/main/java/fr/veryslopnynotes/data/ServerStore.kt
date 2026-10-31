package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult

/**
 * Serveur choisi À L'EXÉCUTION (écran d'appairage) ; la valeur `BuildConfig`
 * n'est qu'une graine par défaut quand rien n'est stocké.
 *
 * - Validé par `ServerConfig.validateBaseUrl` AVANT écriture : ce store est le
 *   point d'écriture unique, pas un second validateur. Refus => `Rejected`,
 *   aucune modification.
 * - Prefs PROPRES à `AccountStore` : le serveur choisi doit survivre à une
 *   déconnexion, sinon on reboucle sur la graine de build.
 * - Aucune donnée d'établissement : l'adresse ne part jamais dans un log ni
 *   dans une exception.
 * ponytail: SharedPreferences seul (une chaîne), pas de DataStore/Room.
 *   Upgrade: liste de serveurs connus si le besoin se prouve.
 */
class ServerStore(context: Context) {
    private val prefs: SharedPreferences? = try {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    } catch (_: Exception) {
        // Préfs KO = graine de build seulement, aucun crash au démarrage.
        null
    }

    /**
     * Le choix persisté s'il est encore valide (une prefs altérée ne doit pas
     * réintroduire un hôte refusé), sinon la graine du build.
     */
    fun baseUrl(seed: String): String {
        val stored = prefs?.getString(KEY_BASE_URL, null) ?: return seed
        val validated = ServerConfig.validateBaseUrl(stored)
        return (validated as? ServerUrlResult.Ok)?.baseUrl ?: seed
    }

    /** `Rejected` = rien n'est écrit, l'adresse courante est conservée. */
    fun save(raw: String): ServerUrlResult {
        val validated = ServerConfig.validateBaseUrl(raw)
        if (validated !is ServerUrlResult.Ok) return validated
        val p = prefs ?: return PREFS_KO
        return try {
            p.edit().putString(KEY_BASE_URL, validated.baseUrl).apply()
            validated
        } catch (_: Exception) {
            PREFS_KO
        }
    }

    companion object {
        const val PREFS = "server"
        private const val KEY_BASE_URL = "base_url"
        private val PREFS_KO = ServerUrlResult.Rejected(
            "Serveur non enregistré (stockage indisponible) : réessayez.",
        )
    }
}
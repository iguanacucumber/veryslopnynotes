package fr.veryslopnynotes.data

import android.content.Context
import fr.veryslopnynotes.core.CleartextPolicy
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult

/**
 * Serveur choisi À L'EXÉCUTION (écran d'appairage) ; la valeur `BuildConfig`
 * n'est qu'une graine par défaut quand rien n'est stocké.
 *
 * - Validé par `ServerConfig.validateBaseUrl` AVANT écriture : ce store est le
 *   point d'écriture unique, pas un second validateur. Refus => `Rejected`,
 *   aucune modification. La politique de clair vient du build appelant
 *   (release = `FORBID`), donc une prefs `http` héritée ne ressort jamais.
 * - Le commit est SYNCHRONE et vérifié ([ServerChoice]) : un `apply()` perdu au
 *   force-stop ne peut plus répondre « enregistré » ; l'échec rend [PREFS_KO].
 * - Prefs PROPRES à `AccountStore` : le serveur choisi doit survivre à une
 *   déconnexion, sinon on reboucle sur la graine de build.
 * - Aucune donnée d'établissement : l'adresse ne part jamais dans un log ni
 *   dans une exception.
 * ponytail: SharedPreferences seul (une chaîne), pas de DataStore/Room.
 *   Upgrade: liste de serveurs connus si le besoin se prouve.
 */
class ServerStore(
    context: Context,
    private val cleartext: CleartextPolicy = CleartextPolicy.FORBID,
) {
    private val choice: ServerChoice? = try {
        ServerChoice(
            SharedPrefsKeyValue(
                context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE),
            ),
            cleartext,
        )
    } catch (_: Exception) {
        // Préfs KO = graine de build seulement, aucun crash au démarrage.
        null
    }

    /**
     * Le choix persisté s'il est encore valide (une prefs altérée ne doit pas
     * réintroduire un hôte refusé), sinon la graine du build.
     */
    fun baseUrl(seed: String): String = choice?.baseUrl(seed) ?: seed

    /** `Rejected` = rien n'est écrit, l'adresse courante est conservée. */
    fun save(raw: String): ServerUrlResult {
        val validated = ServerConfig.validateBaseUrl(raw, cleartext)
        if (validated !is ServerUrlResult.Ok) return validated
        val target = choice ?: return PREFS_KO
        return when (target.save(validated)) {
            is WriteResult.Written -> validated
            else -> PREFS_KO
        }
    }

    /** Efface le choix persistant ; l'appelant retombe alors sur la graine. */
    fun clear(): Boolean = choice?.clear()?.ok == true

    companion object {
        const val PREFS = "server"
        private val PREFS_KO = ServerUrlResult.Rejected(
            "Serveur non enregistré (stockage indisponible) : réessayez.",
        )
    }
}

package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult

/**
 * Serveur choisi À L'EXÉCUTION (écran d'appairage) : l'utilisateur saisit
 * l'adresse de son serveur, la valeur `BuildConfig` n'est plus qu'une graine
 * par défaut quand rien n'est stocké (le flux émulateur 10.0.2.2:3000
 * fonctionne donc sans changement).
 *
 * - UNE seule chaîne, validée par `ServerConfig.validateBaseUrl` AVANT
 *   écriture : ce store n'est pas un second validateur, c'est le point
 *   d'écriture unique. Refus => `Rejected` + aucune modification.
 * - Fichier de prefs PROPRE à `AccountStore` : `logout()` vide ses propres
 *   prefs, or le serveur choisi doit SURVIVRE à une déconnexion (sinon on
 *   rebouclerait sur la graine de build).
 * - Aucune donnée d'établissement ici : pas de nom, pas de compte, aucun
 *   secret. L'adresse ne part jamais dans un log ni dans une exception.
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
     * Adresse courante : le choix persisté s'il est encore VALIDE (une prefs
     *-altérée ou une version antérieure ne doit pas réintroduire un hôte
     * refusé), sinon la graine du build.
     */
    fun baseUrl(seed: String): String {
        val stored = prefs?.getString(KEY_BASE_URL, null) ?: return seed
        val validated = ServerConfig.validateBaseUrl(stored)
        return (validated as? ServerUrlResult.Ok)?.baseUrl ?: seed
    }

    /**
     * Valide puis persiste. `Rejected` = rien n'est écrit (l'appelant affiche
     * le message et garde l'adresse courante).
     */
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
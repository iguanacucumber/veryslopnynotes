package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Comptes appairés + déconnexion (#82, multi-compte parent).
 * - Persiste UNIQUEMENT des accountId (jamais nom, classe, photo, token) :
 *   liste bornée + compte courant. Le profil reste en mémoire (mode anonyme :
 *   aucune donnée personnelle sur disque).
 * - `logout()` invalide la session appairée (TokenStore) ET purge tous les
 *   caches locaux : plus aucune donnée scolaire du compte déconnecté.
 * ponytail: SharedPreferences seul (une liste de chaînes), pas de Room.
 *   Upgrade: Store de comptes avec bascule par compte (hors périmètre).
 */
class AccountStore(
    context: Context,
    private val cacheStore: CacheStore,
    private val tokenStore: TokenStore,
) {
    private val prefs: SharedPreferences = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** AccountId appairés connus, bornés et valides (aucun secret). */
    fun accountIds(): List<String> {
        val raw = prefs.getString(KEY_IDS, null) ?: return emptyList()
        return raw.split(SEP).map { it.trim() }.filter { it.isNotEmpty() && it.length <= MAX_ACCOUNT_ID }
            .take(MAX_ACCOUNTS)
    }

    fun count(): Int = accountIds().size

    /** Enregistre un compte appairé. false = déjà connu ou id invalide. */
    fun add(accountId: String): Boolean {
        val id = accountId.trim()
        if (!isValidAccountId(id)) return false
        val ids = accountIds().toMutableList()
        if (ids.contains(id)) return false
        if (ids.size >= MAX_ACCOUNTS) return false
        ids.add(id)
        prefs.edit().putString(KEY_IDS, ids.joinToString(SEP)).apply()
        if (current() == null) select(id)
        return true
    }

    fun current(): String? {
        val id = prefs.getString(KEY_CURRENT, null)?.trim() ?: return null
        // Compte courant forcément connu de la liste (pas d'état divergent).
        return if (accountIds().contains(id)) id else null
    }

    fun select(accountId: String) {
        val id = accountId.trim()
        if (!isValidAccountId(id) || !accountIds().contains(id)) return
        prefs.edit().putString(KEY_CURRENT, id).apply()
    }

    fun remove(accountId: String) {
        val id = accountId.trim()
        val ids = accountIds().filter { it != id }
        val edit = prefs.edit().putString(KEY_IDS, ids.joinToString(SEP))
        if (current() == id) edit.remove(KEY_CURRENT)
        edit.apply()
    }

    /** Aucun compte connu = mode anonyme (aucune donnée personnelle stockée). */
    fun isAnonymous(): Boolean = accountIds().isEmpty()

    /**
     * Déconnexion : session appairée invalidée + TOUS les caches purgés (les
     * notes/devoirs/EDT sont des données du compte déconnecté). Le profil, lu
     * en mémoire, est abandonné par l'appelant.
     */
    fun logout() {
        tokenStore.clear()
        for (resource in cacheableResources()) cacheStore.clear(resource)
        prefs.edit().clear().apply()
    }

    companion object {
        const val PREFS = "accounts"
        const val MAX_ACCOUNTS = 8
        const val MAX_ACCOUNT_ID = 64
        private const val KEY_IDS = "account_ids"
        private const val KEY_CURRENT = "current_account_id"
        private const val SEP = ","

        fun isValidAccountId(id: String): Boolean = id.isNotBlank() && id.length <= MAX_ACCOUNT_ID

        /** Ressources purgées à la déconnexion = miroir de CACHEABLE_RESOURCES. */
        fun cacheableResources(): List<String> = listOf(
            CachePolicy.GRADES,
            CachePolicy.ASSIGNMENTS,
            CachePolicy.TIMETABLE,
            CachePolicy.EVALUATIONS,
            CachePolicy.NEWS,
            CachePolicy.MENUS,
        )
    }
}
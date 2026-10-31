package fr.veryslopnynotes.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Comptes appairés + déconnexion (multi-compte parent).
 * - Persiste UNIQUEMENT des accountId (jamais nom, classe, photo, jeton) :
 *   liste bornée + compte courant. Le profil reste en mémoire (mode anonyme :
 *   aucune donnée personnelle sur disque).
 * - `logout()` invalide la session appairée (SessionStore) ET purge tous les
 *   caches locaux : plus aucune donnée scolaire du compte déconnecté.
 * - La SEULE écriture est [add], appelée par le Profil quand le client local
 *   répond.
 * ponytail: SharedPreferences seul (une liste de chaînes), pas de Room.
 *   Upgrade: Store de comptes avec bascule par compte (hors périmètre).
 */
class AccountStore(
    context: Context,
    private val cacheStore: CacheStore,
    private val sessions: SessionStore,
) {
    private val prefs: SharedPreferences = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun accountIds(): List<String> {
        val raw = prefs.getString(KEY_IDS, null) ?: return emptyList()
        return raw.split(SEP).map { it.trim() }.filter { it.isNotEmpty() && it.length <= MAX_ACCOUNT_ID }
            .take(MAX_ACCOUNTS)
    }

    /**
     * Comptes appairés connus, jamais moins que la session elle-même.
     *
     * Hors ligne, le client local ne répond pas et [add] n'est jamais appelé :
     * sans plancher, le Profil afficherait « 0 compte » sur un appareil
     * appairé. Une session persistée PROUVE qu'un compte est appairé ; ce
     * plancher ne sert qu'à l'affichage — la liste reste la source des
     * identifiants.
     */
    fun count(): Int = maxOf(accountIds().size, if (sessions.hasSession()) 1 else 0)

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
        return if (accountIds().contains(id)) id else null
    }

    fun select(accountId: String) {
        val id = accountId.trim()
        if (!isValidAccountId(id) || !accountIds().contains(id)) return
        prefs.edit().putString(KEY_CURRENT, id).apply()
    }

    /**
     * Déconnexion : session invalidée + TOUS les caches purgés (les
     * notes/devoirs/EDT sont des données du compte déconnecté). Après
     * `sessions.clear()`, plus aucune lecture ne peut rouvrir la session.
     *
     * L'invalidation d'époque ET la purge sont dans la MÊME section critique :
     * une lecture déjà en vol ne peut plus réécrire le cache après la purge.
     * La purge passe par [CacheScope], partagée avec l'appairage d'un autre
     * compte et la session morte — une seule implémentation.
     */
    fun logout() {
        SessionRepair.purge({ sessions.clear() }, cacheStore)
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
    }
}
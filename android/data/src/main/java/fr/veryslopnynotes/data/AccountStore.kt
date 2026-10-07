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
 * - #178 : la SEULE écriture est [add], appelée par le Profil quand `/v1/me`
 *   répond (`ProfileScreen.refresh`). Avant, elle n'était appelée nulle part :
 *   `account_ids` n'était jamais écrit, donc `count()` valait 0 et `select()`
 *   ne pouvait rien écrire. `remove` et `isAnonymous` ont été SUPPRIMÉS avec
 *   elle — aucun écran ne les atteint (le sélecteur ne propose que des comptes
 *   publiés par `/v1/me`, « retirer un compte » n'a pas d'écran) ; les
 *   réintroduire le jour où un écran les rend visibles.
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

    /** AccountId appairés connus, bornés et valides (aucun secret).
     *  #178 : PRIVÉ — aucun écran ne liste les ids (le sélecteur se construit sur
     *  ce que `/v1/me` publie), donc l'exposer ne donnait qu'une surface que
     *  personne n'atteint. */
    private fun accountIds(): List<String> {
        val raw = prefs.getString(KEY_IDS, null) ?: return emptyList()
        return raw.split(SEP).map { it.trim() }.filter { it.isNotEmpty() && it.length <= MAX_ACCOUNT_ID }
            .take(MAX_ACCOUNTS)
    }

    /**
     * Comptes appairés CONNUS, jamais moins que la session elle-même.
     *
     * #148 (recette des 14 écrans) : hors ligne, `/v1/me` ne répond pas, donc
     * [add] n'est jamais appelé et la liste reste vide — l'écran Profil
     * affichait « 0 compte appairé » sur un appareil APPAIRÉ (jeton présent,
     * `base_url` écrit), pendant que Réglages affichait « 1 compte ». Deux
     * écrans, deux nombres, pour la même réalité.
     *
     * Le plancher vient du [TokenStore] : une session valide PROUVE qu'un
     * compte est appairé. Il ne sert qu'à l'affichage — la liste reste la
     * source des identifiants, donc le sélecteur de compte ne propose toujours
     * que ce que `/v1/me` a publié.
     */
    fun count(): Int = maxOf(accountIds().size, if (tokenStore.isPaired()) 1 else 0)

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

    /**
     * Déconnexion : session appairée invalidée + TOUS les caches purgés (les
     * notes/devoirs/EDT sont des données du compte déconnecté). `tokenStore.clear()`
     * efface l'id, l'empreinte ET le secret porteur (contrat 0.4.0) : après
     * cette ligne, plus aucune requête ne part avec un `Authorization` valide.
     * Le profil, lu en mémoire, est abandonné par l'appelant.
     */
    fun logout() {
        tokenStore.clear()
        // Purge totale : la liste de ressources dérive des contrats, une liste
        // codée en dur laisserait fuiter la donnee d'une ressource ajoutée plus tard.
        cacheStore.clearAll()
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

        // ponytail: miroir de CACHEABLE_RESOURCES, pour les tests de purge par ressource.
        fun cacheableResources(): List<String> = listOf(
            CachePolicy.GRADES,
            CachePolicy.ASSIGNMENTS,
            CachePolicy.TIMETABLE,
            CachePolicy.NEWS,
            CachePolicy.MENUS,
        )
    }
}
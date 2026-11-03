package fr.veryslopnynotes.data

import android.content.Context

/**
 * Comptes appairés (multi-compte parent).
 * - Persiste UNIQUEMENT des accountId (jamais nom, classe, photo, jeton) :
 *   liste bornée + compte courant. Le profil reste en mémoire (mode anonyme :
 *   aucune donnée personnelle sur disque).
 * - Chaque écriture rend un [WriteResult] : un `commit()` refusé n'est plus
 *   confondu avec « déjà connu » ou avec un succès. [record] écrit la liste ET
 *   le compte courant en UN commit, donc une bascule ne reste pas à moitié faite.
 * - La session et le cache sont purgés par `PairingRepository.logoutBlocking`,
 *   sous le verrou de session ; [clear] efface la liste de comptes, rappelé
 *   dans la même section critique par le pont.
 * ponytail: SharedPreferences seul (une liste de chaînes), pas de Room.
 *   Upgrade: Store de comptes avec bascule par compte (hors périmètre).
 */
class AccountStore(
    context: Context,
    private val sessions: SessionStore,
) : AccountRecorder {
    private val registry = AccountRegistry(
        SharedPrefsKeyValue(
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE),
        ),
    )

    /**
     * Comptes appairés connus, jamais moins que la session elle-même.
     *
     * Hors ligne, le client local ne répond pas et [add] n'est jamais appelé :
     * sans plancher, le Profil afficherait « 0 compte » sur un appareil
     * appairé. Une session persistée PROUVE qu'un compte est appairé ; ce
     * plancher ne sert qu'à l'affichage — la liste reste la source des
     * identifiants.
     */
    fun count(): Int = registry.count(sessions.hasSession())

    /** Enregistre un compte appairé. `Refused` = déjà connu, invalide ou plafond. */
    fun add(accountId: String): WriteResult = registry.add(accountId)

    /** Ajout + compte courant en un seul commit : la bascule est indivisible. */
    override fun record(accountId: String): WriteResult = registry.record(accountId)

    /** `Refused` = compte inconnu ou invalide ; rien n'est écrit. */
    fun select(accountId: String): WriteResult = registry.select(accountId)

    fun current(): String? = registry.current()

    /**
     * Déconnexion : plus aucun compte connu. `commit()` : la préférence ne
     * doit pas survivre au force-stop qui suit la déconnexion.
     */
    fun clear(): WriteResult = registry.clear()

    companion object {
        const val PREFS = "accounts"
        const val MAX_ACCOUNTS = AccountRegistry.MAX_ACCOUNTS
        const val MAX_ACCOUNT_ID = AccountRegistry.MAX_ACCOUNT_ID

        fun isValidAccountId(id: String): Boolean = AccountRegistry.isValidAccountId(id)
    }
}

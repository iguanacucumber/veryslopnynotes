package fr.veryslopnynotes.data

/**
 * Le cache est la DONNÉE D'UN COMPTE, jamais celle d'un autre.
 *
 * Clés globales (sans compte) et TTL jusqu'à 24 h : sans garde, l'appairage
 * d'un AUTRE compte servirait le payload du précédent hors ligne. Deux
 * événements purgent : le COMPTE change, ou la SESSION est MORTE.
 *
 * La purge passe par [SessionEpoch] : une lecture en vol ne peut pas réécrire
 * le cache après la purge.
 *
 * La BASCULE de compte (purge + publication du nouveau client) est ATOMIQUE :
 * la purge précède la publication, dans la même section critique, sinon un
 * lecteur voit le nouveau client avec l'ancien cache.
 *
 * ponytail: PURGE, pas de clé scopée — le cache ne contient qu'UN compte à la
 *   fois. Upgrade: plusieurs comptes simultanés ⇒ clé scopée par compte.
 */
object CacheScope {
    /**
     * Purge si les identités diffèrent — une identité INCONNUE purge aussi
     * (fail-closed). [publish] s'exécute APRÈS la purge, dans la MÊME section
     * critique : aucun lecteur ne voit le nouveau client avec l'ancien cache.
     * MÊME compte : cache conservé. Renvoie `true` si le cache a été purgé.
     */
    fun switchAccount(
        store: CacheStore,
        previous: AccountIdentity?,
        current: AccountIdentity?,
        publish: () -> Unit,
    ): Boolean {
        if (previous != null && current != null && previous.sameAccount(current)) {
            publish()
            return false
        }
        purgeWith(store, publish)
        return true
    }

    /**
     * Appairage sans publication : même règle que [switchAccount], le cache
     * d'un autre compte (ou d'une identité inconnue) est purgé.
     */
    fun onAccountPaired(
        store: CacheStore,
        previous: AccountIdentity?,
        current: AccountIdentity?,
    ): Boolean = switchAccount(store, previous, current) {}

    /** Session MORTE : le cache part avec elle (le compte suivant peut être un autre). */
    fun onSessionDead(store: CacheStore) {
        purge(store)
    }

    /**
     * Purge totale sous la garde d'époque : une écriture en vol ne ressuscite
     * pas le cache purgé.
     */
    fun purge(store: CacheStore) {
        purgeWith(store) {}
    }

    /**
     * Efface puis exécute l'action, dans la MÊME section critique d'époque :
     * la bascule de compte publie le nouveau client sans fenêtre.
     */
    private fun purgeWith(store: CacheStore, after: () -> Unit) {
        SessionEpoch.invalidate {
            store.clearAll()
            after()
        }
    }
}

/**
 * Identité d'un compte = établissement (endpoint) + identifiant de connexion.
 * Même login dans deux établissements ≠ même compte.
 *
 * Source : la session PERSISTÉE (jamais `AccountStore.current()`, `null` tant
 * que le magasin multi-compte n'est pas alimenté), écrite à chaque appairage.
 * Le login ne sort jamais : `toString()` est rédigé.
 */
class AccountIdentity private constructor(
    private val endpoint: String,
    private val username: String,
) {
    fun sameAccount(other: AccountIdentity): Boolean =
        endpoint == other.endpoint && username == other.username

    override fun equals(other: Any?): Boolean = other is AccountIdentity && sameAccount(other)

    override fun hashCode(): Int = 31 * endpoint.hashCode() + username.hashCode()

    override fun toString(): String = "AccountIdentity(***)"

    companion object {
        /** `null` = identité INCONNUE (endpoint ou login vide) : fail-closed. */
        fun of(endpoint: String, username: String): AccountIdentity? {
            val school = endpoint.trim()
            val user = username.trim()
            if (school.isEmpty() || user.isEmpty()) return null
            return AccountIdentity(school, user)
        }
    }
}

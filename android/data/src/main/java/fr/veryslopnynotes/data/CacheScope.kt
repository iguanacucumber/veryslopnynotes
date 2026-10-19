package fr.veryslopnynotes.data

/**
 * #407 : le cache est la DONNÉE D'UN COMPTE, jamais celle d'un autre.
 *
 * Les clés de cache sont GLOBALES (`cache_grades.txt`, sans compte) et le TTL
 * va jusqu'à 24 h (capacités) : sans garde, l'appairage d'un AUTRE compte
 * servirait le payload du précédent — hors ligne, sans appel réseau — pendant
 * des heures (Notes, EDT, Cantine, Capacités).
 *
 * DEUX événements font partir le cache :
 * - le COMPTE change (appairage d'un autre compte) ;
 * - la SESSION est MORTE (jeton tourné : plus rien ne prouve que le compte
 *   appairé ensuite est le même).
 *
 * La purge passe par [SessionEpoch] (#364) : une lecture EN VOL ne peut pas
 * réécrire le cache après la purge (elle perd la course d'époque et abandonne
 * son payload), donc le cache purgé ne ressuscite pas.
 *
 * ponytail: PURGE, pas de clé scopée — la clé scopée (ressource+compte)
 *   toucherait tous les appels de `store.load/save` pour un gain nul : le
 *   cache ne contient qu'UN compte à la fois, il suffit de le purger quand ce
 *   compte change. Upgrade: plusieurs comptes SIMULTANÉMENT (sélecteur de
 *   compte, #397) ⇒ clé scopée par compte.
 */
object CacheScope {
    /**
     * Appairage : le cache du compte précédent ne doit JAMAIS être servi au
     * nouveau compte. Purge si les identités diffèrent — une identité
     * INCONNUE purge aussi (fail-closed : sans identité prouvée, on ne sert
     * rien).
     *
     * Renvoie `true` si le cache a été purgé.
     */
    fun onAccountPaired(
        store: CacheStore,
        previous: AccountIdentity?,
        current: AccountIdentity?,
    ): Boolean {
        if (previous != null && current != null && previous.sameAccount(current)) return false
        purge(store)
        return true
    }

    /** Session MORTE : le cache part avec elle (le compte suivant peut être un autre). */
    fun onSessionDead(store: CacheStore) {
        purge(store)
    }

    /**
     * Purge TOTALE sous la garde d'époque : l'invalidation ET la purge sont
     * dans la MÊME section critique (leur ordre est total), donc une écriture
     * en vol ne ressuscite pas le cache purgé.
     */
    fun purge(store: CacheStore) {
        SessionEpoch.invalidate { store.clearAll() }
    }
}

/**
 * #407 : identité d'un compte = établissement (endpoint) + identifiant de
 * connexion. Deux appairages du MÊME compte donnent la MÊME identité ; deux
 * comptes différents, jamais (même login dans deux établissements ≠ même
 * compte).
 *
 * Source : la session PERSISTÉE (jamais `AccountStore.current()`, qui vaut
 * `null` tant que le magasin multi-compte n'est pas alimenté — #397). La
 * session est écrite à CHAQUE appairage, donc elle prouve toujours le compte
 * appairé.
 *
 * Le login ne sort JAMAIS (ni log, ni rapport de crash) : `toString()` est
 * rédigé, comme `StoredSession`.
 */
class AccountIdentity private constructor(
    private val endpoint: String,
    private val username: String,
) {
    /** Même compte (même établissement, même login) ? */
    fun sameAccount(other: AccountIdentity): Boolean =
        endpoint == other.endpoint && username == other.username

    override fun equals(other: Any?): Boolean = other is AccountIdentity && sameAccount(other)

    override fun hashCode(): Int = 31 * endpoint.hashCode() + username.hashCode()

    override fun toString(): String = "AccountIdentity(***)"

    companion object {
        /**
         * `null` = identité INCONNUE (endpoint ou login vide) : le cache ne
         * peut alors pas être réutilisé (fail-closed, cf. [CacheScope]).
         */
        fun of(endpoint: String, username: String): AccountIdentity? {
            val school = endpoint.trim()
            val user = username.trim()
            if (school.isEmpty() || user.isEmpty()) return null
            return AccountIdentity(school, user)
        }
    }
}

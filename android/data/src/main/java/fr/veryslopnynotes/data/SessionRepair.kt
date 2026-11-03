package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ThreadMessageCache

/**
 * La RÉPARATION d'une session MORTE.
 *
 * ICI : session invalidée + cache purgé. C'est le MÊME code que la
 * déconnexion (`PairingRepository.logoutBlocking()`) : UN seul chemin de
 * purge, donc « déconnecté » et « session morte » ne peuvent pas diverger.
 *
 * Le store persisté est chiffré (Android) : la purge prend donc
 * l'INVALIDATION (`invalidateSession`) et non le store — elle reste rejouable
 * hors Gradle, par le harnais de parité.
 *
 * ponytail: un objet, une fonction. Pas de bus d'événements : le signal
 *   `DeviceAuth` a UN abonné, branché une fois au démarrage.
 *   Upgrade: un `StateFlow` si plusieurs écrans doivent observer la session.
 */
object SessionRepair {
    /**
     * Session persistée invalidée, session mémoire abandonnée, cache purgé.
     * La purge passe par [CacheScope.purge] : une lecture en vol ne ressuscite
     * pas le cache purgé. `false` = purge incomplète (l'appelant décide s'il
     * peut continuer).
     */
    fun purge(invalidateSession: () -> Unit, cacheStore: CacheStore): Boolean {
        // Session persistée d'abord (le jeton mort ne doit pas survivre), puis
        // mémoire, puis cache.
        invalidateSession()
        PronoteSession.clear()
        // Les pages de messages et la liste de fils sont des données du compte :
        // elles ne survivent pas à la session qui les a lues (I4).
        ThreadMessageCache.clear()
        DiscussionListCache.clear()
        // Pas de liste codée en dur : elle dériverait des contrats et
        // laisserait fuiter la donnée d'une ressource ajoutée plus tard.
        return CacheScope.purge(cacheStore)
    }
}

package fr.veryslopnynotes.data

/**
 * #397 : la RÉPARATION d'une session MORTE.
 *
 * Le signal « session morte » (`DeviceAuth`) existait, mais AUCUN abonné n'y
 * était branché : `reject()` ne purgeait rien. Le natif gardait le jeton mort
 * ET son cache, et l'interface annonçait « session expirée » par-dessus des
 * données périmées servies comme fraîches.
 *
 * ICI : la purge d'une session morte — session invalidée + cache purgé. C'est
 * le MÊME code que la déconnexion (`AccountStore.logout()`) : UN seul chemin
 * de purge, donc « déconnecté » et « session morte » ne peuvent pas diverger.
 *
 * Le store de session PERSISTÉ est chiffré (Android) : la purge prend donc
 * l'INVALIDATION (`invalidateSession`) et non le store — elle reste ainsi
 * rejouable hors Gradle, par le harnais de parité.
 *
 * ponytail: un objet, une fonction. Pas de bus d'événements : le signal
 *   `DeviceAuth` a UN abonné (l'app), branché UNE fois au démarrage.
 *   Upgrade: un `StateFlow` si plusieurs écrans doivent observer la session.
 */
object SessionRepair {
    /**
     * Purge d'une session morte : la session PERSISTÉE est invalidée, la
     * session en mémoire abandonnée, le cache purgé.
     *
     * La purge passe par [CacheScope.purge] : elle est donc sous la garde
     * d'époque (#364) — une lecture EN VOL ne ressuscite pas le cache purgé.
     */
    fun purge(invalidateSession: () -> Unit, cacheStore: CacheStore) {
        // La session PERSISTÉE d'abord (le jeton mort ne doit pas survivre),
        // puis la session en mémoire (#205 : plus de client, repli cache
        // impossible : les ressources sont purgées juste après), puis le cache.
        invalidateSession()
        PronoteSession.clear()
        // Purge totale : la liste de ressources dérive des contrats, une liste
        // codée en dur laisserait fuiter la donnée d'une ressource ajoutée plus
        // tard.
        CacheScope.purge(cacheStore)
    }
}

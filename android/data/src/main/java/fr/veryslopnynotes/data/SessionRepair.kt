package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ThreadMessageCache

/**
 * Les états de SESSION qui ne vivent pas sur le disque : client en RAM, pages
 * de messages, liste de fils. Ils partent avec la session persistée, sous le
 * verrou de session ; [purge] ajoute le cache pour l'ancien chemin combiné.
 *
 * ponytail: un objet, deux fonctions. Pas de bus d'événements : le signal
 *   `DeviceAuth` a UN abonné, branché une fois au démarrage.
 *   Upgrade: un `StateFlow` si plusieurs écrans doivent observer la session.
 */
object SessionRepair {
    /**
     * Session persistée invalidée, session mémoire abandonnée. Le cache n'est
     * PAS touché ici : `AccountPurgeFactory` l'enregistre comme étape séparée.
     */
    fun clearSession(invalidateSession: () -> Unit) {
        invalidateSession()
        PronoteSession.clear()
        // Les pages de messages et la liste de fils sont des données du compte :
        // elles ne survivent pas à la session qui les a lues (I4).
        ThreadMessageCache.clear()
        DiscussionListCache.clear()
    }
}

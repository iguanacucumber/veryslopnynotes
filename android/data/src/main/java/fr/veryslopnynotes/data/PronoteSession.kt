package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client

// Fournisseur du client local (#205, ADR-003) : les dépôts lisent le téléphone,
// plus le serveur métier. `null` = pas de session (jamais appairé, session
// perdue) : les dépôts replient sur le cache, comme sur un réseau KO.
//
// Le REMPLISSAGE de la session est du ressort de l'appairage (#206) ; ici on
// ne fait que la détenir. `logout()` la purge avec le reste (AccountStore).
// ponytail: un seul détenteur en mémoire, pas de persistance (les credentials
// restent là où #206 les mettra).
typealias PronoteClientProvider = () -> Client?

object PronoteSession {
    @Volatile
    private var current: Client? = null

    fun set(client: Client) {
        current = client
    }

    fun clear() {
        current = null
    }

    val client: Client?
        get() = current
}

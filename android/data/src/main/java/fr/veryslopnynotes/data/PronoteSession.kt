package fr.veryslopnynotes.data

import fr.veryslopnynotes.pronote.Client

// Fournisseur du client local : les dépôts lisent le téléphone, plus le serveur
// métier. `null` = pas de session (jamais appairé, session perdue) : les dépôts
// replient sur le cache, comme sur un réseau KO. Le remplissage est du ressort
// de l'appairage ; `logout()` purge la session avec le reste (AccountStore).
// ponytail: un seul détenteur en mémoire, pas de persistance ici.
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

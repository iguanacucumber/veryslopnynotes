package fr.veryslopnynotes.data

/**
 * UNE seule ouverture/fermeture de session à la fois dans le process.
 *
 * Appairage, restauration ET déconnexion passent par ici : un logout ne peut
 * pas courir pendant qu'une restauration publie le client, sinon la
 * restauration republierait l'ancien compte APRÈS la purge. Verrou PARTAGÉ
 * (pas par dépôt) : le pont et le job de fond ont chacun leur instance.
 *
 * ORDRE DES VERROUS : session -> époque -> store, jamais l'inverse. Aucun
 * chemin ne prend [SessionEpoch] puis ce verrou.
 */
internal object SessionGate {
    private val restoreLock = Any()

    inline fun <T> serialized(block: () -> T): T = synchronized(restoreLock, block)
}

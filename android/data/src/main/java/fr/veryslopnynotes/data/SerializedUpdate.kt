package fr.veryslopnynotes.data

import java.util.concurrent.locks.ReentrantLock

/**
 * UNE serrure pour une lecture-modification-écriture.
 *
 * Relire l'état, le fusionner puis l'écrire doit être une seule section
 * critique : deux enregistrements concurrents qui lisent le même état avant
 * d'écrire se perdraient l'un l'autre. `ReentrantLock` (et non `@Synchronized`)
 * parce que la section couvre la LECTURE et l'ÉCRITURE, pas chaque méthode
 * séparément ; réentrant, donc un dépôt peut relire sous le même verrou.
 */
class SerializedUpdate {
    private val lock = ReentrantLock()

    fun <T> run(block: () -> T): T {
        lock.lock()
        try {
            return block()
        } finally {
            lock.unlock()
        }
    }
}

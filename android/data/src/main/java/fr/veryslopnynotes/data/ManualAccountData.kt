package fr.veryslopnynotes.data

import java.io.File

/**
 * Effacement des données de COMPTE du manuel (I16) : le fichier durable, sa
 * sauvegarde et sa quarantaine, puis les clés héritées des préférences.
 *
 * `removeLegacyPrefs` doit rendre le verdict d'un `commit()` Android : un
 * `apply()` différé ne prouve rien et peut rendre l'ancien manuel au
 * force-stop suivant. `false` = une des deux parties survit, donc la purge de
 * compte reste incomplète et la déconnexion ne doit pas être annoncée.
 */
fun clearManualAccountData(file: File?, removeLegacyPrefs: () -> Boolean): Boolean {
    val fileCleared = file?.let { DurableFile.delete(it) } ?: true
    val prefsCleared = try {
        removeLegacyPrefs()
    } catch (_: Exception) {
        false
    }
    return fileCleared && prefsCleared
}

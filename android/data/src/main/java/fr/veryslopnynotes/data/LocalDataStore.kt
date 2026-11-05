package fr.veryslopnynotes.data

import java.io.File

/**
 * Les fichiers TÉLÉCHARGÉS (pièces jointes, exports PDF) sont la donnée du
 * compte. Ce store couvre `offline/` ET `cacheDir/attachments|photos`, pour
 * qu'aucun chemin de purge n'en oublie un. `cacheDir/exports` n'est PAS purgé
 * ici : l'étape EXPORTS du plan décide (conservé à la déconnexion, effacé à la
 * suppression totale).
 *
 * ponytail: une délégation, pas une nouvelle interface. Upgrade: un store
 *   unique (le cache ET les téléchargements dans le même dossier).
 */
class LocalDataStore(
    private val store: CacheStore,
    private val cacheRoot: File,
) : CacheStore by store {
    override fun clearAll(): Boolean {
        val cacheCleared = store.clearAll()
        // `exports/` est RETENU à la déconnexion : un PDF demandé avant la
        // déconnexion doit survivre au partage. Seule la suppression totale
        // (étape EXPORTS du plan) l'efface ; ce `clearAll` ne doit pas la
        // court-circuiter.
        val downloadsCleared = DownloadedFiles.purge(cacheRoot, DownloadedFiles.ATTACHMENTS)
        // Une photo de cours en attente est de la donnée scolaire : elle part
        // avec le cache même si la capture est restée ouverte.
        val photos = File(cacheRoot, "photos")
        val photosCleared = try {
            photos.deleteRecursively() && !photos.exists()
        } catch (_: Exception) {
            false
        }
        // UN SEUL verdict : le compte suivant ne se publie que si tout est parti.
        return cacheCleared && downloadsCleared && photosCleared
    }
}

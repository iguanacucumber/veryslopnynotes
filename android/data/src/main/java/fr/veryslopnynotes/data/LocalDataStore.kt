package fr.veryslopnynotes.data

import java.io.File

/**
 * Les fichiers TÉLÉCHARGÉS (pièces jointes, exports PDF) sont la donnée du
 * compte : purgés avec le cache, à la déconnexion comme au changement de compte.
 * Ce store couvre `offline/` ET `cacheDir/attachments|exports`, pour qu'aucun
 * chemin de purge n'en oublie un.
 *
 * ponytail: une délégation, pas une nouvelle interface. Upgrade: un store
 *   unique (le cache ET les téléchargements dans le même dossier).
 */
class LocalDataStore(
    private val store: CacheStore,
    private val cacheRoot: File,
) : CacheStore by store {
    override fun clearAll() {
        store.clearAll()
        DownloadedFiles.purge(cacheRoot)
        // Une photo de cours en attente est de la donnée scolaire : elle part
        // avec le cache même si la capture est restée ouverte.
        try {
            File(cacheRoot, "photos").deleteRecursively()
        } catch (_: Exception) {
            // best-effort : le cache est jetable.
        }
    }
}

package fr.veryslopnynotes.data

import java.io.File

/**
 * #540 : les fichiers TÉLÉCHARGÉS (pièces jointes, exports PDF) sont la DONNÉE
 * DU COMPTE : ils sont purgés avec le cache, à la déconnexion comme au
 * changement de compte ou à la session morte.
 *
 * Le store de cache ne connaît que `filesDir/offline/` ; les téléchargements
 * vivent dans le CACHE (`cacheDir/attachments/`, `cacheDir/exports/`). Ce store
 * englobe les deux : UNE purge (`clearAll`), donc pas de chemin de purge qui
 * oublie l'un des deux — le cache purgé laisse derrière lui les pièces
 * jointes du compte parti.
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
        // #587 : une photo de cours en attente est de la donnée scolaire.
        // Elle part avec le cache du compte, même si la capture est restée
        // ouverte au moment de la déconnexion.
        try {
            File(cacheRoot, "photos").deleteRecursively()
        } catch (_: Exception) {
            // best-effort : le cache est jetable.
        }
    }
}

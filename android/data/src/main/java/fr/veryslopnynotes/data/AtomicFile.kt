package fr.veryslopnynotes.data

import java.io.File
import java.io.IOException

/**
 * Remplace [target] en une seule opération visible : le contenu va dans un
 * temporaire du même dossier, puis un `rename` le met en place. Un échec
 * (disque plein, `IOException` du writer) laisse l'ancien fichier INTACT et
 * supprime le temporaire — jamais un fichier à moitié écrit servi ensuite.
 *
 * Le temporaire ne porte PAS le préfixe `cache_` : les scanners du cache ne
 * doivent pas le prendre pour une entrée pendant l'écriture.
 */
internal fun writeFileAtomically(
    target: File,
    bytes: ByteArray,
    write: (File, ByteArray) -> Unit,
) {
    val parent = target.parentFile
    if (parent == null) throw IOException("chemin sans dossier: ${target.name}")
    if (!parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) {
        throw IOException("dossier inaccessible: ${parent.name}")
    }
    val tmp = File.createTempFile("tmp-", ".tmp", parent)
    try {
        write(tmp, bytes)
        replace(tmp, target)
    } finally {
        tmp.delete()
    }
}

/**
 * `rename` refusé (plateforme) : l'ancien fichier est MIS DE CÔTÉ avant le
 * remplacement, jamais effacé d'avance. Un second échec le restaure : le cache
 * précédent survit à une écriture ratée.
 */
private fun replace(source: File, target: File) {
    if (source.renameTo(target)) return
    val backup = File(target.parentFile, "tmp-bak-${target.name}")
    backup.delete()
    if (target.exists() && !target.renameTo(backup)) {
        throw IOException("remplacement impossible: ${target.name}")
    }
    if (!source.renameTo(target)) {
        if (backup.exists()) backup.renameTo(target)
        throw IOException("ecriture impossible: ${target.name}")
    }
    backup.delete()
}

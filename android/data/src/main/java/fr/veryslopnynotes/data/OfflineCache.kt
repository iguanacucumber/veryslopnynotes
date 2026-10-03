package fr.veryslopnynotes.data

import java.io.File

// Entrée cache : payload brut serveur (donnee affichee, jamais interpretee)
// + horodatage ecriture (badge frais/perime via CachePolicy).
data class CachedEntry(val payload: String, val fetchedAt: Long)

// Stockage cache offline. Payload = corps reponse serveur tel quel.
// Cle = ressource cachable (grades/assignments/timetable).
interface CacheStore {
    fun save(resource: String, payload: String, fetchedAt: Long)
    fun load(resource: String): CachedEntry?
    fun clear(resource: String)
    // Purge totale (logout #82) : toute donnee scolaire locale disparait, sans
    // dependre d'une liste de ressources qui deriverait des contrats.
    fun clearAll()
}

// ponytail: memoire seule pour tests/preview. Upgrade: persistance seule (File).
class InMemoryCacheStore : CacheStore {
    private val map = mutableMapOf<String, CachedEntry>()

    @Synchronized
    override fun save(resource: String, payload: String, fetchedAt: Long) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        map[resource] = CachedEntry(payload, fetchedAt)
    }

    @Synchronized
    override fun load(resource: String): CachedEntry? = map[resource]

    @Synchronized
    override fun clear(resource: String) {
        map.remove(resource)
    }

    @Synchronized
    override fun clearAll() {
        map.clear()
    }
}

// Persistance native sans dependance (stdlib java.io seul, pas de Room/DataStore).
// Un fichier par ressource : ligne 1 = fetchedAt (epoch ms), suite = payload.
// Repertoire fourni par l'appelant (ex. context.filesDir, jamais en dur ici).
class FileCacheStore(private val dir: File) : CacheStore {
    private fun fileFor(resource: String): File = File(dir, "cache_$resource.txt")

    @Synchronized
    override fun save(resource: String, payload: String, fetchedAt: Long) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        require(!payload.contains('\u0000')) { "payload invalide" }
        if (!dir.exists()) dir.mkdirs()
        // ponytail: premiere ligne timestamp, reste payload brut. Upgrade: SQLite si requetes.
        fileFor(resource).writeText("$fetchedAt\n$payload")
    }

    @Synchronized
    override fun load(resource: String): CachedEntry? {
        val f = fileFor(resource)
        if (!f.exists()) return null
        return try {
            val text = f.readText()
            val cut = text.indexOf('\n')
            if (cut < 0) return null
            val fetchedAt = text.substring(0, cut).toLongOrNull() ?: return null
            CachedEntry(text.substring(cut + 1), fetchedAt)
        } catch (_: Exception) {
            null
        }
    }

    @Synchronized
    override fun clear(resource: String) {
        try {
            fileFor(resource).delete()
        } catch (_: Exception) {
            // ponytail: clear best-effort (cache seul, pas de donnee critique).
        }
    }

    @Synchronized
    override fun clearAll() {
        try {
            dir.listFiles()?.forEach { it.delete() }
        } catch (_: Exception) {
            // ponytail: purge best-effort, comme clear().
        }
    }
}

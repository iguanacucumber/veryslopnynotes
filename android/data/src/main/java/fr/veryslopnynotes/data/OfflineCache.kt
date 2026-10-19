package fr.veryslopnynotes.data

import java.io.File

// Entrée cache : payload brut serveur (donnee affichee, jamais interpretee)
// + horodatage ecriture (badge frais/perime via CachePolicy) + la requete qui
// l'a produite (#365 : la reponse depend de la requete — semaine, periode,
// algorithme ; une entree d'une autre requete = une entree ABSENTE). La
// requete est obligatoire : une entree sans requete ne repond a rien.
data class CachedEntry(val payload: String, val fetchedAt: Long, val query: String)

// Stockage cache offline. Payload = corps reponse serveur tel quel.
// Cle = ressource cachable (grades/assignments/timetable).
interface CacheStore {
    // La requete fait partie de l'entree (#365) : elle identifie la reponse.
    fun save(resource: String, payload: String, fetchedAt: Long, query: String)
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
    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        map[resource] = CachedEntry(payload, fetchedAt, CachePolicy.normalizeQuery(query))
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
// Un fichier par ressource : ligne 1 = fetchedAt (epoch ms) + requete
// (separateur TAB), suite = payload.
// Repertoire fourni par l'appelant (ex. context.filesDir, jamais en dur ici).
class FileCacheStore(private val dir: File) : CacheStore {
    private fun fileFor(resource: String): File = File(dir, "cache_$resource.txt")

    @Synchronized
    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        require(!payload.contains('\u0000')) { "payload invalide" }
        if (!dir.exists()) dir.mkdirs()
        // ponytail: premiere ligne horodatage + requete, reste payload brut.
        // Upgrade: SQLite si requetes.
        val head = "$fetchedAt\t${CachePolicy.normalizeQuery(query)}"
        fileFor(resource).writeText("$head\n$payload")
    }

    @Synchronized
    override fun load(resource: String): CachedEntry? {
        val f = fileFor(resource)
        if (!f.exists()) return null
        return try {
            val text = f.readText()
            val cut = text.indexOf('\n')
            if (cut < 0) return null
            val head = text.substring(0, cut)
            // Fichier anterieur a #365 : la requete qui l'a produit est
            // inconnue, donc l'entree ne repond a AUCUNE requete — elle est
            // ignoree plutot que servie au hasard (le cache est un affichage
            // jetable : une relecture le regenere, sans reinviter une semaine
            // perimee).
            if (!head.contains('\t')) return null
            val fetchedAt = head.substringBefore('\t').toLongOrNull() ?: return null
            CachedEntry(text.substring(cut + 1), fetchedAt, head.substringAfter('\t', ""))
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
            // #206 : récursif — le sous-dossier des fiches de révision
            // (`revisions/`, données du compte comme le reste) part avec.
            dir.listFiles()?.forEach { it.deleteRecursively() }
        } catch (_: Exception) {
            // ponytail: purge best-effort, comme clear().
        }
    }
}

package fr.veryslopnynotes.data

import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

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

/**
 * Époque de session (#364) : compteur monotone qui distingue deux sessions
 * pour le CACHE.
 *
 * Une lecture capture l'époque AVANT de lire le client local (qui peut mettre
 * des secondes), puis la revérifie JUSTE AVANT d'écrire le cache. Si elle a
 * changé, une déconnexion a eu lieu pendant la lecture : le payload est
 * ABANDONNÉ (rien n'est écrit), donc la purge du cache reste effective.
 *
 * L'invalidation ET la purge sont faites dans la MÊME section critique : leur
 * ordre est total — soit l'écriture précède la purge et la purge l'efface,
 * soit la purge précède et l'écriture est refusée. Il n'y a pas de fenêtre
 * entre les deux (c'était exactement la fenêtre qui annulait la purge).
 *
 * ORDRE DES VERROUS : le verrou d'époque est TOUJOURS pris AVANT le verrou du
 * store (jamais l'inverse) — c'est ce que font `writeIfCurrent` et `invalidate`,
 * qui appellent le store sous le verrou d'époque. Aucun chemin ne prend le
 * verrou du store puis celui de l'époque : pas d'interblocage possible.
 *
 * #404 : la garde ne couvre pas QUE le cache. Toute écriture dans
 * `filesDir/offline/` passe par elle (les fiches de révision et les
 * préférences matière : cf. [OfflineArtifacts]), donc une écriture en vol ne
 * ressuscite pas le dossier purgé par une déconnexion.
 */
object SessionEpoch {
    private val lock = Any()
    private var value = 0L

    /** Époque courante : à capturer au DÉBUT d'une lecture. */
    fun current(): Long = synchronized(lock) { value }

    /**
     * Déconnexion : invalide les lectures en vol ET purge le cache, en une
     * seule section critique.
     */
    fun invalidate(purge: () -> Unit) {
        synchronized(lock) {
            value++
            purge()
        }
    }

    /**
     * Exécute [write] SEULEMENT si l'époque [observed] est encore la bonne.
     * Renvoie `null` si la session a changé depuis [observed] : le payload est
     * alors abandonné (aucune écriture).
     */
    fun <T> writeIfCurrent(observed: Long, write: () -> T): T? =
        synchronized(lock) { if (value == observed) write() else null }
}

// Persistance native sans dependance (stdlib java.io seul, pas de Room/DataStore).
// Un fichier par ressource : ligne 1 = fetchedAt (epoch ms) + requete
// (separateur TAB), suite = payload.
// Repertoire fourni par l'appelant (ex. context.filesDir, jamais en dur ici).
//
// #364 : deux écrivains peuvent viser le MÊME repertoire (l'app et le worker de
// fond ont chacun leur instance) : le verrou est donc PARTAGE par repertoire
// — `@Synchronized` est par INSTANCE, les deux stores ne s'excluaient pas — et
// l'ecriture est ATOMIQUE (fichier temporaire + rename) : un lecteur ne voit
// jamais un fichier tronque ni deux payloads entrelaces.
class FileCacheStore(private val dir: File) : CacheStore {
    private val lock = lockFor(dir)

    private fun fileFor(resource: String): File = File(dir, "cache_$resource.txt")

    // #364 : le verrou est celui du REPERTOIRE (partage entre l'app et le
    // worker de fond), pas celui de l'instance. #365 : l'en-tete porte la
    // requete qui a produit l'entree.
    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        require(!payload.contains('\u0000')) { "payload invalide" }
        synchronized(lock) {
            if (!dir.exists()) dir.mkdirs()
            // ponytail: premiere ligne horodatage + requete, reste payload brut.
            // Upgrade: SQLite si requetes.
            val head = "$fetchedAt\t${CachePolicy.normalizeQuery(query)}"
            writeAtomic(fileFor(resource), "$head\n$payload")
        }
    }

    override fun load(resource: String): CachedEntry? = synchronized(lock) {
        val f = fileFor(resource)
        if (!f.exists()) return@synchronized null
        try {
            val text = f.readText()
            val cut = text.indexOf('\n')
            if (cut < 0) return@synchronized null
            val head = text.substring(0, cut)
            // Fichier anterieur a #365 : la requete qui l'a produit est
            // inconnue, donc l'entree ne repond a AUCUNE requete — elle est
            // ignoree plutot que servie au hasard (le cache est un affichage
            // jetable : une relecture le regenere, sans reinviter une semaine
            // perimee).
            if (!head.contains('\t')) return@synchronized null
            val fetchedAt = head.substringBefore('\t').toLongOrNull() ?: return@synchronized null
            CachedEntry(text.substring(cut + 1), fetchedAt, head.substringAfter('\t', ""))
        } catch (_: Exception) {
            null
        }
    }

    override fun clear(resource: String) {
        synchronized(lock) {
            try {
                fileFor(resource).delete()
            } catch (_: Exception) {
                // ponytail: clear best-effort (cache seul, pas de donnee critique).
            }
        }
    }

    override fun clearAll() {
        synchronized(lock) {
            try {
                // #206 : récursif — le sous-dossier des fiches de révision
                // (`revisions/`, données du compte comme le reste) part avec.
                // #404 : les préférences matière (`subject_prefs.json`) aussi :
                // tout ce qui est écrit dans le dossier `offline/` est de la
                // donnée du compte, donc la purge l'efface en bloc.
                dir.listFiles()?.forEach { it.deleteRecursively() }
            } catch (_: Exception) {
                // ponytail: purge best-effort, comme clear().
            }
        }
    }

    /**
     * Écriture ATOMIQUE : fichier temporaire puis `rename` (atomique sur le
     * même système de fichiers). `writeText` tronquerait d'abord le fichier
     * cible : un lecteur concurrent (ou un autre écrivain) verrait alors un
     * fichier à moitié écrit — qui passe pourtant la vérification de `load`.
     */
    private fun writeAtomic(target: File, content: String) {
        val tmp = File.createTempFile("cache_", ".tmp", dir)
        try {
            tmp.writeText(content)
            if (!tmp.renameTo(target)) {
                // rename refusé (plateforme) : remplacement explicite, un coup de
                // plus, plutôt qu'une écriture en place.
                target.delete()
                if (!tmp.renameTo(target)) throw IOException("ecriture du cache impossible: ${target.name}")
            }
        } finally {
            tmp.delete()
        }
    }

    companion object {
        // Un verrou PAR REPERTOIRE : deux instances du store (l'app et le
        // worker de fond) ecrivent le meme dossier et doivent s'exclure.
        private val locks = ConcurrentHashMap<String, Any>()

        private fun lockFor(dir: File): Any = locks.computeIfAbsent(dir.absolutePath) { Any() }
    }
}

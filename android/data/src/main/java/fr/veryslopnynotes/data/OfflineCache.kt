package fr.veryslopnynotes.data

import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Empreinte de la requete (#477) : 16 caracteres hexadecimaux (SHA-256 tronque).
 *
 * Le nom de fichier doit rester lisible PAR LE SYSTEME (pas de `/`, pas de
 * `?`) et court : l'empreinte remplace la requete brute. Une collision (quasi
 * impossible) ne sert PAS la mauvaise reponse : l'entree verifie sa requete
 * dans son en-tete avant d'etre servie.
 */
private fun queryDigest(query: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest(CachePolicy.normalizeQuery(query).toByteArray(Charsets.UTF_8))
    val out = StringBuilder(16)
    for (i in 0 until 8) {
        val b = digest[i].toInt() and 0xff
        out.append("0123456789abcdef"[b shr 4])
        out.append("0123456789abcdef"[b and 0xf])
    }
    return out.toString()
}

// Entrée cache : payload brut serveur (donnee affichee, jamais interpretee)
// + horodatage ecriture (badge frais/perime via CachePolicy) + la requete qui
// l'a produite (#365 : la reponse depend de la requete — semaine, periode,
// algorithme ; une entree d'une autre requete = une entree ABSENTE). La
// requete est obligatoire : une entree sans requete ne repond a rien.
data class CachedEntry(val payload: String, val fetchedAt: Long, val query: String)

// Stockage cache offline. Payload = corps reponse serveur tel quel.
// Cle = ressource cachable (grades/assignments/timetable).
//
// #477 : une ressource a UNE ENTRÉE PAR REQUÊTE (semaine, période, algorithme).
// Revenir sur une requête déjà vue est servi du cache, sans réseau ; le TTL
// par ressource est inchangé.
interface CacheStore {
    // La requete fait partie de l'entree (#365) : elle identifie la reponse.
    fun save(resource: String, payload: String, fetchedAt: Long, query: String)
    // L'entree de (ressource, requete) : `null` si elle n'existe pas.
    fun load(resource: String, query: String): CachedEntry?
    // TOUS les payloads de la ressource (une par requete) : le balayage de
    // securite lit ce qui est reellement en cache.
    fun payloads(resource: String): List<String>
    // Purge de la ressource : TOUTES ses entrees (une ecriture confirmee
    // invalide l'etat d'avant, quelle que soit la requete).
    fun clear(resource: String)
    // Purge totale (logout #82) : toute donnee scolaire locale disparait, sans
    // dependre d'une liste de ressources qui deriverait des contrats.
    fun clearAll()
}

// ponytail: memoire seule pour tests/preview. Upgrade: persistance seule (File).
class InMemoryCacheStore : CacheStore {
    // Cle = ressource|requete normalisee (#477) : une entree par requete.
    private val map = mutableMapOf<String, CachedEntry>()

    private fun keyOf(resource: String, query: String): String =
        "$resource|${CachePolicy.normalizeQuery(query)}"

    @Synchronized
    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        map[keyOf(resource, query)] = CachedEntry(payload, fetchedAt, CachePolicy.normalizeQuery(query))
        // #477 : une entrée par requête — les entrées PÉRIMÉES de la ressource
        // sont purgées à l'écriture (le cache ne grossit pas sans borne).
        val prefix = "$resource|"
        map.keys
            .filter { it.startsWith(prefix) }
            .forEach { key ->
                val entry = map[key] ?: return@forEach
                if (CachePolicy.isStale(resource, entry.fetchedAt, fetchedAt)) map.remove(key)
            }
    }

    @Synchronized
    override fun load(resource: String, query: String): CachedEntry? = map[keyOf(resource, query)]

    @Synchronized
    override fun payloads(resource: String): List<String> =
        map.entries.filter { it.key.startsWith("$resource|") }.map { it.value.payload }

    @Synchronized
    override fun clear(resource: String) {
        val prefix = "$resource|"
        map.keys.filter { it.startsWith(prefix) }.forEach { map.remove(it) }
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
     * Invalidation des lectures en vol ET purge du cache, en une seule section
     * critique (déconnexion, session morte, ou bascule de compte — #529 : la
     * publication du nouveau client se fait dans cette section aussi).
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
// Un fichier par (ressource, requete) : ligne 1 = fetchedAt (epoch ms) + requete
// (separateur TAB), suite = payload.
// Repertoire fourni par l'appelant (ex. context.filesDir, jamais en dur ici).
//
// #364 : deux écrivains peuvent viser le MÊME repertoire (l'app et le worker de
// fond ont chacun leur instance) : le verrou est donc PARTAGE par repertoire
// — `@Synchronized` est par INSTANCE, les deux stores ne s'excluaient pas — et
// l'ecriture est ATOMIQUE (fichier temporaire + rename) : un lecteur ne voit
// jamais un fichier tronque ni deux payloads entrelaces.
//
// #477 : le nom du fichier porte l'EMPREINTE de la requete : une ressource a
// une entree par requete (revenir sur une semaine deja vue = cache-hit, sans
// reseau). L'entree garde la requete dans son en-tete : une empreinte qui
// tomberait sur une autre requete est IGNOREE (jamais le payload d'une
// semaine affiche a la place d'une autre).
class FileCacheStore(private val dir: File) : CacheStore {
    private val lock = lockFor(dir)

    // #477 : le nom reste lisible (ressource) et lisible par le systeme
    // (empreinte hexadecimale de la requete).
    private fun fileFor(resource: String, query: String): File =
        File(dir, "cache_${resource}_${queryDigest(query)}.txt")

    // Tous les fichiers de la ressource (hache + ancien nom sans empreinte).
    private fun filesOf(resource: String): List<File> {
        val prefix = "cache_${resource}_"
        val legacy = File(dir, "cache_$resource.txt")
        val hashed = dir.listFiles { f -> f.name.startsWith(prefix) }?.sortedBy { it.name } ?: emptyList()
        return if (legacy.exists()) hashed + legacy else hashed
    }

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
            writeAtomic(fileFor(resource, query), "$head\n$payload")
            // #477 : une entrée par requête — les entrées PÉRIMÉES de la
            // ressource sont purgées (le cache ne grossit pas sans borne).
            pruneStale(resource, fetchedAt)
        }
    }

    /** Efface les entrées de la ressource dont le TTL est dépassé (#477). */
    private fun pruneStale(resource: String, now: Long) {
        for (f in filesOf(resource)) {
            try {
                val text = f.readText()
                val cut = text.indexOf('\n')
                // En-tête illisible (fichier ancien) : l'entrée ne répond à
                // aucune requête, elle est effacée.
                val fetchedAt = if (cut < 0) null else text.substring(0, cut).substringBefore('\t').toLongOrNull()
                if (fetchedAt == null || CachePolicy.isStale(resource, fetchedAt, now)) f.delete()
            } catch (_: Exception) {
                // ponytail: purge best-effort (le cache est jetable).
            }
        }
    }

    override fun load(resource: String, query: String): CachedEntry? = synchronized(lock) {
        val f = fileFor(resource, query)
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
            val stored = head.substringAfter('\t', "")
            // L'empreinte a pu tomber sur une autre requete (#477) : on ne
            // sert JAMAIS la reponse d'une requete differente.
            if (CachePolicy.normalizeQuery(stored) != CachePolicy.normalizeQuery(query)) return@synchronized null
            CachedEntry(text.substring(cut + 1), fetchedAt, stored)
        } catch (_: Exception) {
            null
        }
    }

    override fun payloads(resource: String): List<String> = synchronized(lock) {
        val out = mutableListOf<String>()
        for (f in filesOf(resource)) {
            try {
                val text = f.readText()
                val cut = text.indexOf('\n')
                if (cut < 0) continue
                out.add(text.substring(cut + 1))
            } catch (_: Exception) {
                // ponytail: un fichier illisible est ignore, pas fatal.
            }
        }
        out
    }

    override fun clear(resource: String) {
        synchronized(lock) {
            try {
                // #477 : TOUTES les entrees de la ressource (une par requete).
                filesOf(resource).forEach { it.delete() }
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

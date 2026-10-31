package fr.veryslopnynotes.data

import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Empreinte de la requête : 16 caractères hexadécimaux (SHA-256 tronqué).
 * Le nom de fichier doit rester lisible par le système (pas de `/` ni `?`).
 * Une collision ne sert jamais la mauvaise réponse : `load` vérifie la
 * requête dans l'en-tête.
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

// Payload brut serveur (donnée affichée, jamais interprétée) + horodatage +
// la requête qui l'a produite : une entrée d'une autre requête est ABSENTE.
data class CachedEntry(val payload: String, val fetchedAt: Long, val query: String)

// Stockage cache offline : une entrée PAR REQUÊTE (semaine, période,
// algorithme). Revenir sur une requête déjà vue est servi du cache, sans
// réseau ; le TTL par ressource est inchangé.
interface CacheStore {
    fun save(resource: String, payload: String, fetchedAt: Long, query: String)
    fun load(resource: String, query: String): CachedEntry?
    fun payloads(resource: String): List<String>
    fun clear(resource: String)
    // Purge totale (logout) : toute donnée scolaire locale disparaît, sans
    // dépendre d'une liste de ressources qui dériverait des contrats.
    fun clearAll()
}

// ponytail: memoire seule pour tests/preview. Upgrade: persistance seule (File).
class InMemoryCacheStore : CacheStore {
    private val map = mutableMapOf<String, CachedEntry>()

    private fun keyOf(resource: String, query: String): String =
        "$resource|${CachePolicy.normalizeQuery(query)}"

    @Synchronized
    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        map[keyOf(resource, query)] = CachedEntry(payload, fetchedAt, CachePolicy.normalizeQuery(query))
        // Les entrées PÉRIMÉES de la ressource sont purgées à l'écriture (le
        // cache ne grossit pas sans borne).
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
 * Époque de session : compteur monotone qui distingue deux sessions pour le
 * cache. Une lecture capture l'époque AVANT de lire le client local, puis la
 * revérifie juste avant d'écrire : si elle a changé, le payload est abandonné
 * et la purge reste effective.
 *
 * Invalidation et purge sont dans la MÊME section critique : soit l'écriture
 * précède la purge (qui l'efface), soit la purge précède (l'écriture est
 * refusée). Pas de fenêtre entre les deux.
 *
 * ORDRE DES VERROUS : époque TOUJOURS avant le verrou du store, jamais
 * l'inverse — aucun interblocage possible.
 *
 * La garde couvre toute écriture dans `filesDir/offline/`, pas seulement le
 * cache ([OfflineArtifacts] : fiches de révision, préférences matière).
 */
object SessionEpoch {
    private val lock = Any()
    private var value = 0L

    /** Époque courante : à capturer au DÉBUT d'une lecture. */
    fun current(): Long = synchronized(lock) { value }

    /**
     * Invalidation des lectures en vol ET purge du cache, en une seule section
     * critique (déconnexion, session morte, bascule de compte, publication du
     * nouveau client comprise).
     */
    fun invalidate(purge: () -> Unit) {
        synchronized(lock) {
            value++
            purge()
        }
    }

    /**
     * Exécute [write] seulement si l'époque [observed] est encore la bonne.
     * `null` = session changée depuis, aucune écriture.
     */
    fun <T> writeIfCurrent(observed: Long, write: () -> T): T? =
        synchronized(lock) { if (value == observed) write() else null }
}

// Persistance native sans dependance (java.io seul, pas de Room/DataStore).
// Un fichier par (ressource, requête) : ligne 1 = fetchedAt + requête (TAB),
// suite = payload ; répertoire fourni par l'appelant.
//
// Deux écrivains peuvent viser le MÊME répertoire (app et worker) : le verrou
// est PARTAGÉ par répertoire (`@Synchronized` est par instance) et l'écriture
// est atomique (fichier temporaire + rename) : jamais de fichier tronqué ni de
// payloads entrelacés.
//
// Le nom du fichier porte l'empreinte de la requête ; l'entrée garde la requête
// dans son en-tête, donc une empreinte tombée sur une autre requête est IGNORÉE.
class FileCacheStore(private val dir: File) : CacheStore {
    private val lock = lockFor(dir)

    private fun fileFor(resource: String, query: String): File =
        File(dir, "cache_${resource}_${queryDigest(query)}.txt")

    // Tous les fichiers de la ressource (hachés + ancien nom sans empreinte).
    private fun filesOf(resource: String): List<File> {
        val prefix = "cache_${resource}_"
        val legacy = File(dir, "cache_$resource.txt")
        val hashed = dir.listFiles { f -> f.name.startsWith(prefix) }?.sortedBy { it.name } ?: emptyList()
        return if (legacy.exists()) hashed + legacy else hashed
    }

    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        require(!payload.contains('\u0000')) { "payload invalide" }
        synchronized(lock) {
            if (!dir.exists()) dir.mkdirs()
            // ponytail: premiere ligne horodatage + requete, reste payload brut.
            // Upgrade: SQLite si requetes.
            val head = "$fetchedAt\t${CachePolicy.normalizeQuery(query)}"
            writeAtomic(fileFor(resource, query), "$head\n$payload")
            // Les entrées PÉRIMÉES de la ressource sont purgées (borne de
            // taille).
            pruneStale(resource, fetchedAt)
        }
    }

    /** Efface les entrées de la ressource dont le TTL est dépassé. */
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
            // Fichier sans en-tête de requête (ancien) : ignoré plutôt que
            // servi au hasard — une relecture le régénère.
            if (!head.contains('\t')) return@synchronized null
            val fetchedAt = head.substringBefore('\t').toLongOrNull() ?: return@synchronized null
            val stored = head.substringAfter('\t', "")
            // L'empreinte a pu tomber sur une autre requête : on ne sert
            // jamais la réponse d'une requête différente.
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
                filesOf(resource).forEach { it.delete() }
            } catch (_: Exception) {
                // ponytail: clear best-effort (cache seul, pas de donnee critique).
            }
        }
    }

    override fun clearAll() {
        synchronized(lock) {
            try {
                // Récursif : `revisions/` et `subject_prefs.json` sont de la
                // donnée du compte comme le reste, la purge efface tout
                // `offline/`.
                dir.listFiles()?.forEach { it.deleteRecursively() }
            } catch (_: Exception) {
                // ponytail: purge best-effort, comme clear().
            }
        }
    }

    /**
     * Écriture ATOMIQUE : fichier temporaire puis `rename`. `writeText`
     * tronquerait d'abord la cible : un lecteur concurrent verrait un fichier
     * à moitié écrit qui passe pourtant la vérification de `load`.
     */
    private fun writeAtomic(target: File, content: String) {
        val tmp = File.createTempFile("cache_", ".tmp", dir)
        try {
            tmp.writeText(content)
            if (!tmp.renameTo(target)) {
                // rename refusé (plateforme) : remplacement explicite plutôt
                // qu'une écriture en place.
                target.delete()
                if (!tmp.renameTo(target)) throw IOException("ecriture du cache impossible: ${target.name}")
            }
        } finally {
            tmp.delete()
        }
    }

    companion object {
        // Un verrou PAR RÉPERTOIRE : l'app et le worker écrivent le même dossier
        // et doivent s'exclure.
        private val locks = ConcurrentHashMap<String, Any>()

        private fun lockFor(dir: File): Any = locks.computeIfAbsent(dir.absolutePath) { Any() }
    }
}

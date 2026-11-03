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
private const val MAX_FILE_BYTES = CachePolicy.MAX_PAYLOAD_BYTES + 4096L

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
    // Payloads encore FRAIS : l'IA et les écrans agrégés ne lisent pas une
    // entrée dont le TTL est dépassé (une semaine oubliée, une alerte vieille).
    fun freshPayloads(resource: String, now: Long): List<String>
    fun clear(resource: String)
    // Purge totale (logout) : toute donnée scolaire locale disparaît, sans
    // dépendre d'une liste de ressources qui dériverait des contrats.
    // `false` = effacement INCOMPLET : l'appelant ne publie pas le compte suivant.
    fun clearAll(): Boolean
}

// ponytail: memoire seule pour tests/preview. Upgrade: persistance seule (File).
class InMemoryCacheStore : CacheStore {
    // Accès = ordre LRU : `get`/`put` déplacent la clé en fin de parcours.
    private val map = LinkedHashMap<String, CachedEntry>(16, 0.75f, true)
    private var totalBytes = 0L

    private fun keyOf(resource: String, query: String): String =
        "$resource|${CachePolicy.normalizeQuery(query)}"

    private fun bytesOf(entry: CachedEntry): Long =
        entry.payload.toByteArray(Charsets.UTF_8).size.toLong()

    @Synchronized
    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        require(!CachePolicy.isPayloadTooLarge(payload)) { "payload hors borne" }
        val normalized = CachePolicy.normalizeQuery(query)
        val key = keyOf(resource, query)
        map.remove(key)?.let { totalBytes -= bytesOf(it) }
        val entry = CachedEntry(payload, fetchedAt, normalized)
        map[key] = entry
        totalBytes += bytesOf(entry)
        pruneStale(resource, fetchedAt)
        capResource(resource)
        capTotal()
    }

    private fun pruneStale(resource: String, now: Long) {
        val prefix = "$resource|"
        val iterator = map.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (!entry.key.startsWith(prefix)) continue
            if (CachePolicy.isStale(resource, entry.value.fetchedAt, now)) {
                totalBytes -= bytesOf(entry.value)
                iterator.remove()
            }
        }
    }

    private fun capResource(resource: String) {
        val prefix = "$resource|"
        val cap = CachePolicy.maxEntriesFor(resource)
        var count = map.entries.count { it.key.startsWith(prefix) }
        while (count > cap) {
            val victim = map.entries.firstOrNull { it.key.startsWith(prefix) } ?: break
            totalBytes -= bytesOf(victim.value)
            map.remove(victim.key)
            count -= 1
        }
    }

    private fun capTotal() {
        while (totalBytes > CachePolicy.MAX_TOTAL_BYTES) {
            val victim = map.entries.firstOrNull() ?: break
            totalBytes -= bytesOf(victim.value)
            map.remove(victim.key)
        }
    }

    @Synchronized
    override fun load(resource: String, query: String): CachedEntry? = map[keyOf(resource, query)]

    @Synchronized
    override fun payloads(resource: String): List<String> =
        map.entries.filter { it.key.startsWith("$resource|") }.map { it.value.payload }

    @Synchronized
    override fun freshPayloads(resource: String, now: Long): List<String> =
        map.entries
            .filter { it.key.startsWith("$resource|") }
            .filter { !CachePolicy.isStale(resource, it.value.fetchedAt, now) }
            .map { it.value.payload }

    @Synchronized
    override fun clear(resource: String) {
        val prefix = "$resource|"
        val iterator = map.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (!entry.key.startsWith(prefix)) continue
            totalBytes -= bytesOf(entry.value)
            iterator.remove()
        }
    }

    @Synchronized
    override fun clearAll(): Boolean {
        map.clear()
        totalBytes = 0
        return true
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
class FileCacheStore internal constructor(
    private val dir: File,
    private val writeFile: (File, ByteArray) -> Unit,
) : CacheStore {
    constructor(dir: File) : this(dir, { file, bytes -> file.writeBytes(bytes) })

    private val lock = lockFor(dir)

    private class DiskEntry(val fetchedAt: Long?, val query: String?, val payload: String)

    private class CacheInfo(val file: File, val bytes: Long, val fetchedAt: Long?)

    /** Horodatage d'accès monotone : deux accès dans la même ms restent ordonnés. */
    private fun touch(file: File) {
        val stamp = stampFor(dir)
        try {
            file.setLastModified(stamp)
        } catch (_: Exception) {
            // ponytail: LRU best-effort (le cache reste borné par les octets).
        }
    }

    private fun fileFor(resource: String, query: String): File =
        File(dir, "cache_${resource}_${queryDigest(query)}.txt")

    // Tous les fichiers de la ressource (hachés + ancien nom sans empreinte).
    private fun filesOf(resource: String): List<File> {
        val prefix = "cache_${resource}_"
        val legacy = File(dir, "cache_$resource.txt")
        val hashed = dir.listFiles { f -> f.name.startsWith(prefix) }?.sortedBy { it.name } ?: emptyList()
        return if (legacy.exists()) hashed + legacy else hashed
    }

    private fun isFileOf(resource: String, file: File): Boolean =
        file.name == "cache_$resource.txt" || file.name.startsWith("cache_${resource}_")

    private fun cacheFiles(): List<File> =
        dir.listFiles { f -> f.isFile && f.name.startsWith("cache_") && f.name.endsWith(".txt") }
            ?.sortedWith(compareBy({ it.lastModified() }, { it.name }))
            .orEmpty()

    /**
     * Lit une entrée SANS jamais matérialiser un payload hors budget. Un
     * fichier trop gros (écrit par une version antérieure) est effacé : le
     * servir allouerait sa taille en mémoire.
     */
    private fun readEntry(file: File): DiskEntry? = try {
        if (file.length() > MAX_FILE_BYTES) {
            file.delete()
            null
        } else {
            val text = file.readText()
            val cut = text.indexOf('\n')
            if (cut < 0) {
                DiskEntry(null, null, "")
            } else {
                val head = text.substring(0, cut)
                val fetchedAt = head.substringBefore('\t').toLongOrNull()
                val query = if (head.contains('\t')) head.substringAfter('\t', "") else null
                val payload = text.substring(cut + 1)
                if (payload.toByteArray(Charsets.UTF_8).size > CachePolicy.MAX_PAYLOAD_BYTES) {
                    file.delete()
                    null
                } else {
                    DiskEntry(fetchedAt, query, payload)
                }
            }
        }
    } catch (_: Exception) {
        null
    }

    /**
     * Éviction LRU : l'accès met à jour `lastModified` (compteur monotone par
     * répertoire) ; l'écriture purge les entrées périmées de la ressource, la
     * borne d'entrées par ressource, puis le budget global en octets UTF-8.
     */
    override fun save(resource: String, payload: String, fetchedAt: Long, query: String) {
        require(CachePolicy.isCacheable(resource)) { "ressource non cachable: $resource" }
        require(!payload.contains('\u0000')) { "payload invalide" }
        require(!CachePolicy.isPayloadTooLarge(payload)) { "payload hors borne" }
        synchronized(lock) {
            if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
                throw IOException("dossier de cache inaccessible: ${dir.name}")
            }
            // ponytail: premiere ligne horodatage + requete, reste payload brut.
            // Upgrade: SQLite si requetes.
            val head = "$fetchedAt\t${CachePolicy.normalizeQuery(query)}"
            val target = fileFor(resource, query)
            writeAtomic(target, "$head\n$payload")
            touch(target)
            enforceBudgets(resource, fetchedAt)
        }
    }

    private fun enforceBudgets(resource: String, now: Long) {
        // Une seule lecture par fichier : taille, TTL et ordre LRU ensemble.
        val infos = cacheFiles().mapNotNull { file ->
            readEntry(file)?.let { entry ->
                CacheInfo(file, entry.payload.toByteArray(Charsets.UTF_8).size.toLong(), entry.fetchedAt)
            }
        }
        for (info in infos) {
            if (!isFileOf(resource, info.file)) continue
            val fetchedAt = info.fetchedAt
            if (fetchedAt == null || CachePolicy.isStale(resource, fetchedAt, now)) info.file.delete()
        }
        val cap = CachePolicy.maxEntriesFor(resource)
        var count = infos.count { isFileOf(resource, it.file) && it.file.exists() }
        for (info in infos.sortedBy { it.file.lastModified() }) {
            if (count <= cap) break
            if (isFileOf(resource, info.file) && info.file.delete()) count -= 1
        }
        var total = infos.filter { it.file.exists() }.sumOf { it.bytes }
        for (info in infos.sortedBy { it.file.lastModified() }) {
            if (total <= CachePolicy.MAX_TOTAL_BYTES) break
            if (info.file.exists() && info.file.delete()) total -= info.bytes
        }
    }

    override fun load(resource: String, query: String): CachedEntry? = synchronized(lock) {
        val f = fileFor(resource, query)
        if (!f.exists()) return@synchronized null
        val entry = readEntry(f) ?: return@synchronized null
        val fetchedAt = entry.fetchedAt ?: return@synchronized null
        // Fichier sans en-tête de requête (ancien) : ignoré plutôt que servi
        // au hasard — une relecture le régénère.
        val stored = entry.query ?: return@synchronized null
        // L'empreinte a pu tomber sur une autre requête : on ne sert jamais la
        // réponse d'une requête différente.
        if (CachePolicy.normalizeQuery(stored) != CachePolicy.normalizeQuery(query)) return@synchronized null
        touch(f)
        CachedEntry(entry.payload, fetchedAt, stored)
    }

    override fun payloads(resource: String): List<String> = synchronized(lock) {
        filesOf(resource).mapNotNull { f -> readEntry(f)?.payload }
    }

    override fun freshPayloads(resource: String, now: Long): List<String> = synchronized(lock) {
        val out = mutableListOf<String>()
        for (f in filesOf(resource)) {
            val entry = readEntry(f) ?: continue
            val fetchedAt = entry.fetchedAt ?: continue
            if (CachePolicy.isStale(resource, fetchedAt, now)) continue
            out.add(entry.payload)
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

    override fun clearAll(): Boolean = synchronized(lock) {
        // `deleteRecursively` renvoie `false` quand un fichier résiste : le
        // résultat est VÉRIFIÉ, sinon une purge ratée passait pour un succès.
        val children = dir.listFiles() ?: return@synchronized !dir.exists()
        var ok = true
        for (child in children) {
            try {
                if (!child.deleteRecursively() || child.exists()) ok = false
            } catch (_: Exception) {
                ok = false
            }
        }
        ok && dir.listFiles()?.isEmpty() != false
    }

    /**
     * Écriture ATOMIQUE : fichier temporaire puis `rename`. Une écriture
     * partielle (disque plein) laisse la cible précédente intacte.
     */
    private fun writeAtomic(target: File, content: String) {
        writeFileAtomically(target, content.toByteArray(Charsets.UTF_8), writeFile)
    }

    companion object {
        // Un verrou PAR RÉPERTOIRE : l'app et le worker écrivent le même dossier
        // et doivent s'exclure.
        private val locks = ConcurrentHashMap<String, Any>()

        // Compteur d'accès par répertoire : l'ordre LRU survit aux deux
        // instances (app + worker) qui partagent un dossier.
        private val stamps = ConcurrentHashMap<String, Long>()

        private fun lockFor(dir: File): Any = locks.computeIfAbsent(dir.absolutePath) { Any() }

        private fun stampFor(dir: File): Long {
            val now = System.currentTimeMillis()
            return stamps.compute(dir.absolutePath) { _, previous -> maxOf(now, (previous ?: 0L) + 1L) } ?: now
        }
    }
}

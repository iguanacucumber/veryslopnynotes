package fr.veryslopnynotes.data

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

// Préférences matière (parité Papillon) : couleur #RRGGBB, emoji court, libellé
// perso. Clé = nom de matière. Miroir strict de shared/contracts SubjectPrefs :
// garde-fou isValid() avant écriture, donc jamais de donnée libre stockée ni
// interprétée (I6). Matière sans prefs = nom de matière seul.
data class SubjectPrefs(
    val subject: String,
    val color: String? = null,
    val emoji: String? = null,
    val label: String? = null,
    val updatedAt: String,
) {
    fun toJson(): String = JSONObject().apply {
        put("subject", subject)
        if (color != null) put("color", color)
        if (emoji != null) put("emoji", emoji)
        if (label != null) put("label", label)
        put("updatedAt", updatedAt)
    }.toString()

    companion object {
        const val MAX_COUNT = 64

        /**
         * Contrat d'une matière : les règles vivent dans [SubjectPrefRules], la
         * source UNIQUE partagée avec le pont, qui les exécute. Dépôt et pont
         * valident donc pareil.
         */
        fun isValid(p: SubjectPrefs): Boolean =
            SubjectPrefRules.invalidField(p.subject, p.color, p.emoji, p.label) == null &&
                p.updatedAt.trim().isNotEmpty()

        // Absent/malformé = prefs ignorée (jamais de valeur inventée).
        fun fromJson(raw: String): SubjectPrefs? = try {
            val o = JSONObject(raw)
            val p = SubjectPrefs(
                subject = o.optStringOrNull("subject")?.trim().orEmpty(),
                color = o.optStringOrNull("color"),
                emoji = o.optStringOrNull("emoji"),
                label = o.optStringOrNull("label"),
                updatedAt = o.optStringOrNull("updatedAt")?.trim().orEmpty(),
            )
            if (isValid(p)) p else null
        } catch (_: Exception) {
            null
        }

        fun listFromJson(raw: String): List<SubjectPrefs> = try {
            val arr = JSONArray(raw)
            val out = mutableListOf<SubjectPrefs>()
            for (i in 0 until arr.length()) {
                if (out.size >= MAX_COUNT) break
                val o = arr.optJSONObject(i) ?: continue
                val p = fromJson(o.toString()) ?: continue
                out.add(p)
            }
            out
        } catch (_: Exception) {
            emptyList()
        }
    }
}

private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

// Écriture JSON de la liste (ordre stable = celui de la liste).
fun subjectPrefsListToJson(prefs: List<SubjectPrefs>): String {
    val arr = JSONArray()
    for (p in prefs) arr.put(JSONObject(p.toJson()))
    return arr.toString()
}

// Fusion local + distant : le plus récent gagne par matière, le local gagne en
// cas d'égalité/dérive d'horloge.
// ponytail: pas de file de conflits ni d'historique. Upgrade: résolution
// explicite et conservation des deux versions en cas de modification concurrente.
fun mergeSubjectPrefs(local: List<SubjectPrefs>, remote: List<SubjectPrefs>): List<SubjectPrefs> {
    val by = LinkedHashMap<String, SubjectPrefs>()
    for (p in remote) if (SubjectPrefs.isValid(p)) by[p.subject] = p
    for (p in local) {
        if (!SubjectPrefs.isValid(p)) continue
        val cur = by[p.subject]
        if (cur == null || isoMillis(p.updatedAt) >= isoMillis(cur.updatedAt)) by[p.subject] = p
    }
    return by.values.take(SubjectPrefs.MAX_COUNT)
}

private fun isoMillis(iso: String): Long = try {
    Instant.parse(iso).toEpochMilli()
} catch (_: Exception) {
    0L
}

// Stockage local des prefs : un fichier JSON (stdlib java.io seule, pas de
// Room/DataStore). Repli mémoire si disque KO.
interface SubjectPrefsLocalStore {
    fun load(): List<SubjectPrefs>
    /**
     * [epoch] = époque de session capturée au DÉBUT de l'opération. L'écriture
     * est REFUSÉE si la session a changé : `false`, fichier non écrit, le
     * répertoire purgé ne ressuscite pas.
     */
    fun save(prefs: List<SubjectPrefs>, epoch: Long): Boolean
}

class FileSubjectPrefsStore(private val file: File) : SubjectPrefsLocalStore {
    @Synchronized
    override fun load(): List<SubjectPrefs> = try {
        if (file.exists()) SubjectPrefs.listFromJson(file.readText()) else emptyList()
    } catch (_: Exception) {
        // ponytail: cache preferences = best-effort, pas de donnée critique.
        emptyList()
    }

    @Synchronized
    override fun save(prefs: List<SubjectPrefs>, epoch: Long): Boolean =
        // L'écriture passe par la garde d'époque (comme le cache) : une
        // écriture commencée avant la purge de déconnexion est abandonnée.
        OfflineArtifacts.writeText(
            file,
            subjectPrefsListToJson(prefs.take(SubjectPrefs.MAX_COUNT)),
            epoch,
        )
}

class InMemorySubjectPrefsStore : SubjectPrefsLocalStore {
    private var prefs: List<SubjectPrefs> = emptyList()

    @Synchronized
    override fun load(): List<SubjectPrefs> = prefs

    @Synchronized
    override fun save(prefs: List<SubjectPrefs>, epoch: Long): Boolean =
        // Même garde que le store disque : le refus est le même partout.
        SessionEpoch.writeIfCurrent(epoch) {
            this.prefs = prefs.take(SubjectPrefs.MAX_COUNT)
            true
        } ?: false
}

/**
 * Issue d'un enregistrement. `INVALID` (hors contrat, rien n'a changé) et
 * `REFUSED` (garde d'époque : session changée) ne se ressemblent pas.
 */
enum class SubjectPrefsWrite {
    WRITTEN,

    INVALID,

    REFUSED,
}

// Offline-first : l'affichage lit le FICHIER local (survit au restart, lisible
// hors ligne) ; le fichier EST la vérité. Callback sur main thread.
class SubjectPrefsRepository(
    private val local: SubjectPrefsLocalStore,
    private val main: Handler = Handler(Looper.getMainLooper()),
) {
    fun prefs(): List<SubjectPrefs> = try {
        local.load()
    } catch (_: Exception) {
        emptyList()
    }

    // Écriture locale immédiate (offline), `updatedAt` par l'appareil.
    // [epoch] capturée au DÉBUT par l'appelant : l'écriture est abandonnée si
    // la session a changé, le dossier purgé ne ressuscite pas.
    fun upsert(
        subject: String,
        color: String?,
        emoji: String?,
        label: String?,
        epoch: Long,
    ): SubjectPrefsWrite {
        val p = SubjectPrefs(
            subject = subject.trim(),
            color = color?.trim()?.takeIf { it.isNotEmpty() },
            emoji = emoji?.trim()?.takeIf { it.isNotEmpty() },
            label = label?.trim()?.takeIf { it.isNotEmpty() },
            updatedAt = Instant.now().toString(),
        )
        if (!SubjectPrefs.isValid(p)) return SubjectPrefsWrite.INVALID
        if (!write(mergeSubjectPrefs(prefs(), listOf(p)), epoch)) return SubjectPrefsWrite.REFUSED
        return SubjectPrefsWrite.WRITTEN
    }

    fun refresh(baseUrl: String, onDone: (List<SubjectPrefs>) -> Unit) {
        post(onDone, prefs())
    }

    /** false = l'écriture a été refusée (la session a changé depuis [epoch]). */
    private fun write(prefs: List<SubjectPrefs>, epoch: Long): Boolean {
        return try {
            local.save(prefs, epoch)
        } catch (_: Exception) {
            // ponytail: prefs = préférences, pas de donnée critique (perdues, pas crash).
            false
        }
    }

    private fun post(onDone: (List<SubjectPrefs>) -> Unit, prefs: List<SubjectPrefs>) {
        try {
            main.post { onDone(prefs) }
        } catch (_: Exception) {
            onDone(prefs)
        }
    }
}

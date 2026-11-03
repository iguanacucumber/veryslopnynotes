package fr.veryslopnynotes.app

import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DataExport
import fr.veryslopnynotes.data.DownloadedFiles
import fr.veryslopnynotes.data.ExportInput
import fr.veryslopnynotes.data.ExportSection
import fr.veryslopnynotes.data.LocalDataUnreadable
import fr.veryslopnynotes.data.SubjectSnapshot
import fr.veryslopnynotes.data.buildDataExport
import fr.veryslopnynotes.data.orStale
import fr.veryslopnynotes.data.parseDataExport
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Export local : construit le JSON des données de l'utilisateur, l'écrit dans
 * le cache d'exports (purgé avec le compte, I16) puis ouvre le partage Android.
 *
 * Aucun réseau. Aucun champ de session, de clé LLM, d'adresse de serveur ni
 * d'identifiant n'est lu ici : voir [DataExport.WITHHELD].
 */
internal fun VsnBridge.dataExport(p: JSONObject, epoch: Long): JSONObject = try {
    val exportedAt = Instant.now().toString()
    val grades = repo.allPayloads(CachePolicy.GRADES, epoch).orStale()
    val notes = lessons.notes()
    val chat = teacherChat.load()
    val manual = manuals.exportSnapshot()
    val subjects = prefsRepo.prefs().map {
        SubjectSnapshot(it.subject, it.color, it.emoji, it.label, it.updatedAt)
    }
    val json = buildDataExport(
        ExportInput(
            exportedAt = exportedAt,
            grades = grades,
            notes = notes,
            teacherChat = chat,
            manual = manual,
            subjects = subjects,
            newsReadIds = exportReadIds(p),
        ),
    )
    val bytes = json.toByteArray(Charsets.UTF_8)
    if (bytes.size > DataExport.MAX_BYTES) {
        return exportFailure("Export trop volumineux : réduis les données puis réessaie.")
    }
    val file = DownloadedFiles.write(
        File(ctx.cacheDir, DownloadedFiles.EXPORTS),
        "data-export",
        exportedAt.take(10),
        "donnees.json",
        bytes,
        epoch,
    ) ?: return exportFailure("Session modifiée : export annulé.")
    shareFile(file, "application/json", "Exporter mes données")?.let { return exportFailure(it) }
    val manifest = parseDataExport(json)?.manifest
    JSONObject()
        .put("ok", true)
        .put("sections", JSONArray().apply {
            for (section in manifest?.sections ?: emptyList<ExportSection>()) {
                put(
                    JSONObject()
                        .put("name", section.name)
                        .put("count", section.count)
                        .put("skipped", section.skipped),
                )
            }
        })
        .put("withheld", JSONArray(manifest?.withheld ?: DataExport.WITHHELD))
} catch (e: LocalDataUnreadable) {
    exportFailure(e.message ?: LocalDataUnreadable.MESSAGE)
} catch (_: Exception) {
    exportFailure("Export indisponible : réessaie dans un instant.")
}

private fun exportFailure(message: String): JSONObject =
    JSONObject().put("ok", false).put("message", message)

private fun exportReadIds(p: JSONObject): List<String> {
    val array = p.optJSONArray("newsReadIds") ?: return emptyList()
    val out = ArrayList<String>(array.length().coerceAtMost(DataExport.MAX_READ_IDS))
    for (i in 0 until array.length()) {
        if (out.size >= DataExport.MAX_READ_IDS) break
        val id = array.optString(i, "").trim().take(DataExport.MAX_READ_ID_CHARS)
        if (id.isNotEmpty() && id !in out) out.add(id)
    }
    return out
}



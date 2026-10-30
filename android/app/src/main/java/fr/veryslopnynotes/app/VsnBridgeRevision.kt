package fr.veryslopnynotes.app

import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.RevisionFailure
import fr.veryslopnynotes.core.RevisionPdf
import fr.veryslopnynotes.core.RevisionSheet
import fr.veryslopnynotes.core.listRevisionSheets
import fr.veryslopnynotes.core.loadRevisionSheet
import fr.veryslopnynotes.data.DownloadedFiles
import fr.veryslopnynotes.data.LlmError
import fr.veryslopnynotes.data.SessionEpoch
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Cause d'un échec de génération de fiche, depuis l'exception levée.
 * `AiError` = garde I5 (sortie non conforme au schéma `{"fiche"}`) ;
 * `LlmError` = fournisseur (clé refusée, quota, réseau, sortie tronquée).
 */
internal fun VsnBridge.revisionFailure(e: Throwable): RevisionFailure = when {
    e is AiError -> RevisionFailure.FORMAT
    e is LlmError -> when (e.status) {
        401, 403 -> RevisionFailure.KEY
        429 -> RevisionFailure.QUOTA
        else -> RevisionFailure.PROVIDER
    }
    else -> RevisionFailure.UNKNOWN
}

// --- Fiches de révision ----------------------------------------------------

internal fun VsnBridge.revisionList(): JSONObject {
    val store = revisions ?: return JSONObject().put("sheets", JSONArray())
    val sheets = try {
        listRevisionSheets(store).sortedByDescending { it.date }
    } catch (_: Exception) {
        emptyList()
    }
    return JSONObject().put("sheets", JSONArray().apply { sheets.forEach { put(revisionJson(it)) } })
}

internal fun VsnBridge.revisionLoad(p: JSONObject): JSONObject {
    val store = revisions ?: return JSONObject().put("sheet", JSONObject.NULL)
    val sheet = try {
        loadRevisionSheet(store, bounded(p.string("id"), 80))
    } catch (_: Exception) {
        null
    }
    return JSONObject().put("sheet", sheet?.let { revisionJson(it) } ?: JSONObject.NULL)
}

internal fun VsnBridge.revisionExportPdf(p: JSONObject): JSONObject {
    val store = revisions
        ?: return JSONObject().put("ok", false).put("message", "Fiches indisponibles.")
    val id = bounded(p.string("id"), 80)
    val sheet = try {
        loadRevisionSheet(store, id)
    } catch (_: Exception) {
        null
    } ?: return JSONObject().put("ok", false).put("message", "Fiche introuvable.")
    return try {
        // #540 : le MÊME nom que les pièces jointes (l'IDENTIFIANT de la
        // fiche d'abord), la MÊME garde d'époque (une exportation pendant
        // une déconnexion n'est pas écrite) et le MÊME cache borné.
        val epoch = SessionEpoch.current()
        val bytes = ByteArrayOutputStream().use { out ->
            RevisionPdf.writeSheet(sheet, out)
            out.toByteArray()
        }
        val file = DownloadedFiles.write(
            File(ctx.cacheDir, DownloadedFiles.EXPORTS),
            "fiches",
            sheet.id,
            "fiche.pdf",
            bytes,
            epoch,
        ) ?: return JSONObject().put("ok", false).put("message", "Export PDF indisponible.")
        openFile(file, "application/pdf")
        JSONObject().put("ok", true)
    } catch (_: Exception) {
        JSONObject().put("ok", false).put("message", "Export PDF indisponible.")
    }
}

internal fun VsnBridge.revisionJson(sheet: RevisionSheet): JSONObject = JSONObject()
    .put("id", sheet.id)
    .put("title", sheet.title)
    .put("subject", sheet.subject)
    .put("date", sheet.date)
    .put("body", sheet.body)
    .put("sources", JSONArray(sheet.sources))

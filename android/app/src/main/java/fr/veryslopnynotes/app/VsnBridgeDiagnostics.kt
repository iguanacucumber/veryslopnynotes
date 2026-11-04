package fr.veryslopnynotes.app

import android.os.Build
import android.webkit.WebView
import fr.veryslopnynotes.core.ManualCatalog
import fr.veryslopnynotes.data.DiagnosticInput
import fr.veryslopnynotes.data.DownloadedFiles
import fr.veryslopnynotes.data.SessionEpoch
import fr.veryslopnynotes.data.StaleSessionRead
import fr.veryslopnynotes.data.buildDiagnostic
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Dernier échec du pont, en mémoire seulement : code borné + domaine/clé de
 * ressource. Jamais le message, le payload ni un paramètre. La valeur repart
 * dans l'allowlist de `DiagnosticExport` ; ici elle n'est qu'un candidat.
 */
internal class DiagnosticState {
    private val lock = Any()
    private var errorCode = "none"
    private var resource = "none"

    fun record(method: String, code: String, params: JSONObject?) {
        val nextResource = when {
            method.startsWith("resources.") ->
                params?.optString("key").orEmpty().ifEmpty { "resources" }
            else -> method.substringBefore('.')
        }
        synchronized(lock) {
            errorCode = code
            resource = nextResource
        }
    }

    fun snapshot(): Pair<String, String> = synchronized(lock) { errorCode to resource }

    fun clear() {
        synchronized(lock) {
            errorCode = "none"
            resource = "none"
        }
    }
}

/**
 * L'aperçu EST le fichier : `preview` fige le JSON exact, `share` écrit ces
 * octets. L'interface ne peut donc pas afficher un contenu et en partager un
 * autre. Purger au changement de compte empêche un aperçu de survivre à la
 * session qui l'a produit (I16).
 */
internal class DiagnosticPreviewStore {
    private var payload: String? = null
    private var fields: String? = null

    @Synchronized
    fun put(payload: String, fields: String) {
        this.payload = payload
        this.fields = fields
    }

    @Synchronized
    fun peek(): Pair<String, String>? {
        val currentPayload = payload
        val currentFields = fields
        return if (currentPayload != null && currentFields != null) {
            currentPayload to currentFields
        } else {
            null
        }
    }

    @Synchronized
    fun clear() {
        payload = null
        fields = null
    }
}

internal fun VsnBridge.previewDiagnostic(epoch: Long): JSONObject = try {
    if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
    val json = buildDiagnostic(diagnosticInput())
    if (!SessionEpoch.isCurrent(epoch)) throw StaleSessionRead()
    val fields = JSONObject(json)
    diagnosticPreview.put(json, fields.toString())
    JSONObject().put("ok", true).put("fields", fields)
} catch (_: Exception) {
    diagnosticFailure("Diagnostic indisponible : réessaie dans un instant.")
}

/**
 * Partage UNIQUEMENT l'aperçu déjà affiché, via le sélecteur Android.
 * Aucun réseau, aucune destination choisie par l'application.
 */
internal fun VsnBridge.shareDiagnostic(epoch: Long): JSONObject {
    val pending = diagnosticPreview.peek()
        ?: return diagnosticFailure("Prépare d'abord le diagnostic.")
    return try {
        val bytes = pending.first.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_DIAGNOSTIC_BYTES) {
            return diagnosticFailure("Diagnostic trop volumineux : réessaie.")
        }
        val file = DownloadedFiles.write(
            File(ctx.cacheDir, DownloadedFiles.EXPORTS),
            "diagnostic",
            "diagnostic",
            "diagnostic.json",
            bytes,
            epoch,
        ) ?: return diagnosticFailure("Session modifiée : diagnostic annulé.")
        shareFile(file, "application/json", "Partager le diagnostic")
            ?.let { return diagnosticFailure(it) }
        diagnosticPreview.clear()
        JSONObject().put("ok", true)
    } catch (_: Exception) {
        diagnosticFailure("Partage du diagnostic impossible : réessaie dans un instant.")
    }
}

/** Code + ressource d'un résultat d'appel en échec, sans son message libre. */
internal fun VsnBridge.noteDiagnosticOutcome(method: String, params: JSONObject?, result: JSONObject) {
    if (method.startsWith("diagnostics.")) return
    val errorText = if (result.isNull("error")) "" else result.optString("error")
    val failed = errorText.isNotBlank() ||
        (result.has("ok") && !result.optBoolean("ok", true))
    if (!failed) return
    val cause = result.optString("cause")
    val code = if (cause.isNotBlank()) cause else result.optString("code").ifBlank { "unknown" }
    diagnosticState.record(method, code, params)
}

private fun VsnBridge.diagnosticInput(): DiagnosticInput {
    val (errorCode, resource) = diagnosticState.snapshot()
    return DiagnosticInput(
        generatedAt = Instant.now().toString(),
        appVersion = BuildConfig.VERSION_NAME,
        androidVersion = Build.VERSION.RELEASE.orEmpty(),
        androidApi = Build.VERSION.SDK_INT,
        webViewVersion = currentWebViewVersion(),
        errorCode = errorCode,
        resource = resource,
        classLevel = classLevel(),
        authState = sessionStatus().optString("state", "unknown"),
    )
}

private fun currentWebViewVersion(): String = try {
    WebView.getCurrentWebViewPackage()?.versionName.orEmpty()
} catch (_: Exception) {
    ""
}

/**
 * Niveau de classe seulement (« 2de », « Terminale ») : le libellé complet
 * reste sur l'appareil, il peut nommer un établissement ou un groupe.
 */
private fun VsnBridge.classLevel(): String = try {
    val label = cachedProfile?.classLabel?.takeIf { it.isNotBlank() } ?: manuals.classLabel()
    if (label.isBlank()) "" else ManualCatalog.levelLabel(ManualCatalog.levelOf(label, manuals.subjects()))
} catch (_: Exception) {
    ""
}

private fun diagnosticFailure(message: String): JSONObject =
    JSONObject().put("ok", false).put("message", message)

private const val MAX_DIAGNOSTIC_BYTES = 16 * 1024

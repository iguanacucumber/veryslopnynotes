package fr.veryslopnynotes.ui

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.RevisionKv
import fr.veryslopnynotes.core.RevisionPdf
import fr.veryslopnynotes.core.dayLabelFr
import fr.veryslopnynotes.core.isRevisionSheetValid
import fr.veryslopnynotes.core.listRevisionSheets
import fr.veryslopnynotes.core.loadRevisionSheet
import java.io.File
import java.io.FileOutputStream

// Fiches révision #30 : liste des fiches assemblées sur l'appareil + export PDF
// local (PdfDocument natif, #207).
//
// #144 — cet écran était un BIDON, et le détail est dans ce qu'il faisait :
//   - AppNav l'appelait `RevisionSheetsScreen()`, donc `sheets` valait TOUJOURS
//     `emptyList()` : la liste n'a jamais rien affiché, quelle que soit la
//     route serveur ;
//   - il exposait deux boutons de DÉVELOPPEUR dans l'interface : « Charger » et
//     « Simuler erreur », qui ne faisaient qu'écrire un littéral dans un `String` ;
//   - son état était ce `String` à trois valeurs magiques ;
//   - `RevisionSheetUi.body` n'était jamais rendu.
//
// #206 — le serveur ne sert plus les fiches (il ne sert que des manuels) :
// l'écran lit le store local (`RevisionKv` fichier, mêmes `listRevisionSheets`
// que les jobs) et exporte par `FileProvider`, comme les pièces jointes des
// devoirs. Zéro réseau, zéro allowlist.
//
// I6 : le corps d'une fiche est une DONNÉE, affichée par `Text` seul — jamais
// interprété, jamais exécuté, jamais cliquable.

/**
 * Fiche du store local -> fiche affichable. Une fiche non conforme est
 * IGNORÉE (jamais affichée à moitié) : c'est l'écran qui en fera un état
 * vide, pas une exception.
 */
private fun fr.veryslopnynotes.core.RevisionSheet.toUi(): RevisionSheetUi? {
    if (!isRevisionSheetValid(this)) return null
    return RevisionSheetUi(
        id = id,
        title = title,
        subject = subject,
        date = date,
        sources = sources,
        body = body,
    )
}

/**
 * Une fiche de révision telle que l'écran l'affiche.
 *
 * [body] EXISTS depuis toujours dans ce data class et n'était jamais rendu : c'est
 * le cœur de la fiche, donc il est maintenant affiché en entier.
 */
data class RevisionSheetUi(
    val id: String,
    val title: String,
    val subject: String,
    val date: String,
    val sources: List<String>,
    val body: String,
)

/**
 * État de l'écran, TYPE SCELLÉ (avant : un `String` à littéraux magiques —
 * `"idle"`, `"loading"`, `"error"` — que rien ne vérifiait).
 */
sealed interface RevisionState {
    data object Loading : RevisionState
    data object Empty : RevisionState

    /** Fiches servies par le réseau ; [fetchedAt] = âge du relevé. */
    data class Ready(val sheets: List<RevisionSheetUi>, val fetchedAt: Long) : RevisionState

    data class Failed(val message: String) : RevisionState
}

private fun boundedSources(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val out = mutableListOf<String>()
    for (i in 0 until array.length()) {
        if (out.size >= MAX_SHEET_SOURCES) break
        if (array.isNull(i)) continue
        val value = array.optString(i, "").trim().take(MAX_SOURCE_CHARS)
        if (value.isNotEmpty() && !out.contains(value)) out.add(value)
    }
    return out
}

/**
 * Store local des fiches : fichiers du répertoire `offline/revisions` (données
 * du compte : `AccountStore.logout()` les purge avec le reste via `clearAll`).
 * Clés assainies (pas de `..`, pas de séparateur) : rien ne s'écrit ailleurs.
 */
private class FileRevisionKv(dir: File) : RevisionKv {
    private val dir = dir

    private fun fileFor(key: String): File {
        val safe = key.map {
            if (it.isLetterOrDigit() || it == '-' || it == '_' || it == '.') it else '_'
        }.joinToString("").take(120).ifEmpty { "_" }
        return File(dir, "$safe.bin")
    }

    override fun get(key: String): ByteArray? = try {
        fileFor(key).takeIf { it.isFile }?.readBytes()
    } catch (_: Exception) {
        null
    }

    override fun set(key: String, value: ByteArray) {
        dir.mkdirs()
        fileFor(key).writeBytes(value)
    }
}

/**
 * Carte d'une fiche : titre, matière + date, corps EN ENTIER, sources, export.
 *
 * Le corps n'est pas tronqué : c'est la fiche, et le store la garde déjà
 * bornée. Le tronquer afficherait une fiche incomplète sans dire qu'elle l'est.
 */
@Composable
private fun RevisionSheetCard(
    sheet: RevisionSheetUi,
    onExportPdf: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    PapCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // `heading()` : le titre de la fiche est le titre de la carte.
            Text(
                text = sheet.title,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            // #147 : « lundi 05/10 » (`dayLabelFr`) À LA PLACE de la tranche ISO brute.
            val meta = listOf(sheet.subject, dayLabelFr(sheet.date)).filter { it.isNotBlank() }.joinToString(" · ")
            if (meta.isNotEmpty()) {
                Text(
                    text = meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            PapDivider()
            // Donnée locale ci-dessous (fiche assemblée sur l'appareil) :
            // affichée telle quelle, jamais interprétée ni exécutée (I6). Elle n'est
            // PAS bornée : c'est la fiche entière, dans une liste qui défile —
            // tronquer une fiche sans écran de détail perdrait l'information.
            Text(text = sheet.body, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = "SOURCES",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            for (source in sheet.sources) {
                Text(
                    text = "• $source",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            TextButton(onClick = { onExportPdf(sheet.id) }) { Text("Exporter en PDF") }
        }
    }
}

/** Écran fiches : un état UNIQUE, jamais un écran vide avec des boutons de test. */
@Composable
fun RevisionSheetsScreen(
    state: RevisionState,
    notice: String? = null,
    onRefresh: () -> Unit = {},
    onExportPdf: (String) -> Unit = {},
) {
    // La colonne paddée englobe TOUS les états : sans elle, le squelette de
    // chargement était collé au bord de l'écran (les briques Papillon paddent
    // elles-mêmes, le corps d'écran non).
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (state) {
            RevisionState.Loading -> PapLoading()
            RevisionState.Empty -> PapEmptyState(
                icon = Icons.Filled.Info,
                title = "Aucune fiche de révision",
                description = "Une fiche est générée automatiquement à l'annonce d'un DS détecté avec certitude.",
                action = { Button(onClick = onRefresh) { Text("Actualiser") } },
            )
            is RevisionState.Failed -> PapErrorState(message = state.message, onRetry = onRefresh)
            is RevisionState.Ready -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (notice != null) {
                    Text(
                        text = notice,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                // Âge des fiches AFFICHÉES. Pas de `PapStaleBanner` ici, et c'est
                // délibéré : les fiches sont lues du store local, jamais
                // d'un cache réseau — un bandeau « hors ligne » dirait un
                // mensonge. La date dit la même chose sans inventer de cache.
                Text(
                    text = "Fiches rechargées ${relativeTimeFr(state.fetchedAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item(key = "entete") {
                        PapSectionHeader(
                            icon = Icons.Filled.Create,
                            title = "Fiches de révision",
                            count = state.sheets.size,
                        )
                    }
                    for (sheet in state.sheets) {
                        item(key = sheet.id) {
                            RevisionSheetCard(sheet, onExportPdf)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Route fiches : lecture du store LOCAL (fiches assemblées sur l'appareil,
 * #207), jamais de réseau. Export PDF par `FileProvider` (même motif que les
 * pièces jointes des devoirs) : l'ouvreur externe lit des octets produits ici,
 * aucun credential ne transite.
 */
@Composable
fun RevisionSheetsRoute() {
    val context = LocalContext.current
    val main = remember { Handler(Looper.getMainLooper()) }
    // Même racine "offline" que les caches (données du compte : purge au
    // logout), sous-dossier propre pour ne pas croiser les `cache_*.txt`.
    val kv = remember(context) {
        try {
            FileRevisionKv(File(File(context.filesDir, "offline"), "revisions"))
        } catch (_: Exception) {
            null
        }
    }
    var state by remember { mutableStateOf<RevisionState>(RevisionState.Loading) }
    // #147 : le message d'export ouvert ou non survit à la rotation.
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    fun post(block: () -> Unit) {
        try {
            main.post { block() }
        } catch (_: Exception) {
            block()
        }
    }

    fun refresh() {
        refreshing = true
        Thread {
            val outcome = try {
                val sheets = kv?.let { listRevisionSheets(it) }.orEmpty()
                    .mapNotNull { it.toUi() }
                    .sortedByDescending { it.date }
                // Liste vide = aucune fiche, ce n'est pas une erreur.
                if (sheets.isEmpty()) RevisionState.Empty else RevisionState.Ready(sheets, System.currentTimeMillis())
            } catch (_: Exception) {
                RevisionState.Failed("Fiches illisibles.")
            }
            post {
                state = outcome
                refreshing = false
            }
        }.start()
    }
    LaunchedEffect(Unit) { refresh() }

    fun exportPdf(id: String) {
        // Fiche relue du store (l'id vient de la liste affichée, donc du
        // store) puis PDF rendu sur place : aucun réseau, aucune URL.
        // ponytail: aucun journal — un nom de fichier finit dans les logs.
        notice = try {
            val store = kv ?: throw IllegalStateException("store indisponible")
            val sheet = loadRevisionSheet(store, id.trim().take(80))
                ?: throw IllegalStateException("fiche introuvable")
            val safeName = sheet.id.map {
                if (it.isLetterOrDigit() || it == '-' || it == '_') it else '_'
            }.joinToString("").take(80).ifEmpty { "fiche" }
            val dir = File(File(context.cacheDir, "exports"), "fiches")
            dir.mkdirs()
            val file = File(dir, "$safeName.pdf")
            FileOutputStream(file).use { RevisionPdf.writeSheet(sheet, it) }
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, ATTACHMENT_PROVIDER_AUTHORITY, file,
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            "L'export s'ouvre dans une autre application."
        } catch (_: Exception) {
            "Aucune application ne peut ouvrir cet export PDF."
        }
    }

    HomePullToRefresh(refreshing = refreshing, onRefresh = { refresh() }) {
        RevisionSheetsScreen(
            state = state,
            notice = notice,
            onRefresh = { refresh() },
            onExportPdf = { exportPdf(it) },
        )
    }
}
package fr.veryslopnynotes.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
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
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.dayLabelFr
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.RefreshOutcome
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

// Fiches révision #30 : liste des fiches sourcées + export PDF via le serveur.
//
// #144 — cet écran était un BIDON, et le détail est dans ce qu'il faisait :
//   - AppNav l'appelait `RevisionSheetsScreen()`, donc `sheets` valait TOUJOURS
//     `emptyList()` : la liste n'a jamais rien affiché, quelle que soit la
//     route serveur ;
//   - il exposait deux boutons de DÉVELOPPEUR dans l'interface : « Charger » et
//     « Simuler erreur », qui ne faisaient qu'écrire un littéral dans un `String` ;
//   - son état était ce `String` à trois valeurs magiques ;
//   - `RevisionSheetUi.body` n'était jamais rendu, et `ServerConfig
//     .revisionSheetsUrl` / `revisionSheetPdfUrl` n'étaient appelés nulle part.
//
// La route serveur, elle, EXISTE (`GET /v1/revision-sheets` et
// `GET /v1/revision-sheets/pdf?id=`, cf. `server/api/router.ts`) et sert la forme
// exacte du contrat : `sheets[].body`, `sources`, `examId`, `date`. L'écran est
// donc câblé dessus pour de vrai.
//
// I6 : le corps d'une fiche est produit par le pipeline du serveur (LLM + manuel
// de l'établissement) : c'est une DONNÉE, affichée par `Text` seul — jamais
// interprété, jamais exécuté, jamais cliquable.
//
// ponytail: `/v1/revision-sheets` n'est PAS dans `CACHEABLE_RESOURCES` (les
//   fiches sont peu nombreuses et changent à chaque DS), donc PAS de cache : le
//   GET passe par le même `ApiClient` que `fetchAssignmentsWeek` dans
//   `Assignments.kt`, et l'état garde son horodatage pour le bandeau « périmé ».
//   Upgrade: `revision-sheets` en ressource cachable (contrat shared) si le
//   hors-ligne devient nécessaire.

/** Bornes de lecture du payload (défensives : le contrat ne borne que le volume). */
private const val MAX_SHEET_ID = 80
private const val MAX_SHEET_TITLE = 200
private const val MAX_SHEET_SUBJECT = 100
private const val MAX_SHEET_SOURCES = 14
private const val MAX_SOURCE_CHARS = 200

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
 * Payload `/v1/revision-sheets` -> fiches affichables.
 *
 * Mêmes règles que le contrat `isRevisionSheet` : `id`, `examId`, `subject`,
 * `title` et `body` non vides, `sources` non vide. Une fiche non conforme est
 * IGNORÉE (jamais affichée à moitié) ; un payload illisible donne une liste vide
 * propre — c'est l'écran qui en fera un état vide, pas une exception.
 */
fun revisionSheetsFromPayload(payload: String?): List<RevisionSheetUi> = try {
    if (payload == null) {
        emptyList()
    } else {
        val root = JSONObject(payload)
        val array = root.optJSONArray("sheets") ?: JSONArray()
        val out = ArrayList<RevisionSheetUi>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            val id = obj.optString("id", "").trim().take(MAX_SHEET_ID)
            val examId = obj.optString("examId", "").trim().take(MAX_SHEET_ID)
            val title = obj.optString("title", "").trim().take(MAX_SHEET_TITLE)
            val subject = obj.optString("subject", "").trim().take(MAX_SHEET_SUBJECT)
            val body = obj.optString("body", "").trim()
            val sources = boundedSources(obj.optJSONArray("sources"))
            if (id.isEmpty() || examId.isEmpty() || title.isEmpty() || subject.isEmpty()) continue
            if (body.isEmpty() || sources.isEmpty()) continue
            out.add(
                RevisionSheetUi(
                    id = id,
                    title = title,
                    subject = subject,
                    date = obj.optString("date", "").trim(),
                    sources = sources,
                    body = body,
                ),
            )
        }
        out.sortedByDescending { it.date }
    }
} catch (_: Exception) {
    emptyList()
}

/**
 * Carte d'une fiche : titre, matière + date, corps EN ENTIER, sources, export.
 *
 * Le corps n'est pas tronqué : c'est la fiche, et le serveur la publie déjà
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
            // Donnée serveur ci-dessous (texte de fiche produit par le pipeline) :
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
                // délibéré : `/v1/revision-sheets` n'est pas une ressource cachée,
                // donc aucune donnée de cet écran ne peut être « périmée » — un
                // bandeau « hors ligne » dirait un mensonge. La date dit la même
                // chose sans inventer de cache.
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
 * Route fiches : `GET /v1/revision-sheets` sur le même `ApiClient` que le reste de
 * l'app (donc la même allowlist serveur, I1, et le même jeton d'appareil), puis
 * export PDF par l'allowlist.
 *
 * L'export passe par un `Intent ACTION_VIEW` comme les pièces jointes des devoirs
 * (`Assignments.kt`) : c'est la même limite, donc la même honnêteté — l'ouvreur
 * externe ne porte pas le jeton d'appareil, donc `/v1/revision-sheets/pdf` lui
 * répondra « session requise » tant qu'aucun `FileProvider` ne sert les octets
 * téléchargés par l'app. Le bouton est donc annoncé comme tel, et l'échec est
 * dit dans l'écran plutôt que masqué. Upgrade: téléchargement par l'app +
 * `FileProvider` (module app), comme la photo du profil #82.
 */
@Composable
fun RevisionSheetsRoute(
    api: ApiClient,
    baseUrl: String,
) {
    val context = LocalContext.current
    val main = remember { Handler(Looper.getMainLooper()) }
    var state by remember { mutableStateOf<RevisionState>(RevisionState.Loading) }
    // #147 : le message d'export ouvert ou non survit à la rotation.
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    fun refresh() {
        refreshing = true
        fetchRevisionSheets(api, baseUrl, main) { outcome ->
            state = when (outcome) {
                is RefreshOutcome.Updated ->
                    if (outcome.payload.isNullOrBlank()) {
                        RevisionState.Empty
                    } else {
                        val sheets = revisionSheetsFromPayload(outcome.payload)
                        // 200 + liste vide = aucune fiche, ce n'est pas une erreur.
                        if (sheets.isEmpty()) RevisionState.Empty else RevisionState.Ready(sheets, outcome.fetchedAt)
                    }
                is RefreshOutcome.OfflineFallback ->
                    if (outcome.payload.isNullOrBlank()) RevisionState.Empty else RevisionState.Ready(revisionSheetsFromPayload(outcome.payload), outcome.fetchedAt)
                is RefreshOutcome.Failed -> RevisionState.Failed(outcome.message)
            }
            refreshing = false
        }
    }
    LaunchedEffect(Unit) { refresh() }

    fun exportPdf(id: String) {
        // Chemin issu de ServerConfig seul (I1). L'id est assaini par le serveur
        // (`revisionIdForExam` : `[A-Za-z0-9_-]`), donc il ne peut pas injecter un
        // paramètre dans l'URL.
        val url = ServerConfig.revisionSheetPdfUrl(baseUrl, id)
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // ponytail: aucun journal — une URL finit dans les logs d'accès.
        notice = try {
            context.startActivity(intent)
            "L'export s'ouvre dans une autre application, qui affichera « session requise » : elle ne porte pas votre jeton d'appareil."
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

/**
 * GET `/v1/revision-sheets`, jamais écrit sur disque (ressource hors
 * `CACHEABLE_RESOURCES`).
 *
 * Même plomberie que `fetchPeriods` de `SyncedRepository` et que
 * `fetchAssignmentsWeek` d'`Assignments.kt` : replis francs, un 401 reste nu
 * (le cache ne masque jamais une session morte), jamais d'exception vers l'UI.
 */
private fun fetchRevisionSheets(
    api: ApiClient,
    baseUrl: String,
    main: Handler,
    cb: (RefreshOutcome) -> Unit,
) {
    if (baseUrl.isBlank()) {
        postRevisionOutcome(main, cb, RefreshOutcome.Failed("Serveur non configuré.", null))
        return
    }
    val request = try {
        api.buildGet(ServerConfig.revisionSheetsUrl(baseUrl).removePrefix(baseUrl))
    } catch (_: IllegalArgumentException) {
        postRevisionOutcome(main, cb, RefreshOutcome.Failed("URL hors allowlist serveur", null))
        return
    }
    api.client().newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            postRevisionOutcome(main, cb, RefreshOutcome.Failed("Fiches indisponibles hors-ligne.", null))
        }

        override fun onResponse(call: Call, response: Response) {
            response.use {
                if (it.code == ApiClient.HTTP_UNAUTHORIZED) {
                    postRevisionOutcome(main, cb, RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null))
                    return
                }
                val body = if (it.isSuccessful) it.body?.string() else null
                if (body.isNullOrEmpty()) {
                    // 200 + corps vide et HTTP en échec n'ont pas la même cause,
                    // donc pas le même message (le vocabulaire de `refreshAsync`).
                    val message = if (it.isSuccessful) "Réponse vide." else "Réponse serveur ${it.code}."
                    postRevisionOutcome(main, cb, RefreshOutcome.Failed(message, null))
                    return
                }
                // Contenu serveur = donnée affichée, jamais interprétée (I6/I7).
                postRevisionOutcome(main, cb, RefreshOutcome.Updated(body, System.currentTimeMillis()))
            }
        }
    })
}

/** Callback sur le thread principal : Compose ne lit l'état que depuis l'UI. */
private fun postRevisionOutcome(main: Handler, cb: (RefreshOutcome) -> Unit, outcome: RefreshOutcome) {
    try {
        main.post { cb(outcome) }
    } catch (_: Exception) {
        cb(outcome)
    }
}
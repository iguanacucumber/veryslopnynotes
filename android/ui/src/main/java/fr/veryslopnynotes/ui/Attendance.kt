package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.SyncedRepository
import org.json.JSONArray
import org.json.JSONObject

// #77 parité Papillon, écran « Vie scolaire » : absences + retards unifiés
// (kind), compteurs par période et liste des sanctions.
// org.json = plateforme Android (aucune dépendance ajoutée). Le payload est une
// DONNÉE structurée du contrat : on lit des champs, jamais de texte libre
// interprété (I6). Onglet vie scolaire absent de l'établissement = réponse
// [] : état vide propre (pas d'erreur, pas de contenu inventé).
// ponytail: pas de ViewModel (état local comme les autres écrans, UiState) ;
//   upgrade: ViewModel + Flow quand #82 câblerà la navigation complète.

private const val MAX_MOTIF_CHARS = 500
private const val MAX_SUBJECT_CHARS = 64
private const val MAX_NAME_CHARS = 100
private val ABSENCE_KINDS = listOf("absence", "late")

data class AbsenceUi(
    val id: String,
    val kind: String,
    val date: String,
    val dateEnd: String? = null,
    val subject: String? = null,
    val motif: String? = null,
    val minutes: Int? = null,
    val justified: Boolean? = null,
    val periodId: String? = null,
)

data class PeriodCountUi(
    val periodId: String,
    val name: String,
    val absences: Int = 0,
    val late: Int = 0,
    val minutes: Int = 0,
)

data class AttendanceUi(
    val absences: List<AbsenceUi> = emptyList(),
    val periods: List<PeriodCountUi> = emptyList(),
)

data class PunishmentUi(
    val date: String,
    val type: String,
    val motif: String,
    val gravity: String? = null,
)

private fun bound(s: String, max: Int): String = s.trim().take(max)

private fun optBounded(obj: JSONObject, key: String, max: Int): String? {
    val raw = obj.optString(key, "").trim()
    return if (raw.isEmpty()) null else bound(raw, max)
}

private fun optMinutes(obj: JSONObject): Int? {
    val v = obj.optDouble("durationMinutes", Double.NaN)
    if (v.isNaN() || v < 0) return null
    return v.toInt()
}

private fun optInt(obj: JSONObject, key: String): Int {
    val v = obj.optDouble(key, Double.NaN)
    return if (v.isNaN() || v < 0) 0 else v.toInt()
}

/** Gravité publiée : texte pour l'affichage, null si l'établissement ne la publie pas. */
private fun optNumber(obj: JSONObject, key: String): String? {
    val v = obj.optDouble(key, Double.NaN)
    if (v.isNaN() || v < 0) return null
    // Entier sans décimale ("1" et non "1.0") : même rendu que le miroir TS.
    return if (v == Math.floor(v)) v.toLong().toString() else v.toString()
}

/** Payload /v1/attendance -> liste (plus récente d'abord) + compteurs par période. */
fun attendanceFrom(payload: String?): AttendanceUi = try {
    if (payload == null) {
        AttendanceUi()
    } else {
        val root = JSONObject(payload)
        val absences = mutableListOf<AbsenceUi>()
        val arr = root.optJSONArray("absences") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val id = obj.optString("id", "").trim()
            val kind = obj.optString("kind", "").trim()
            val date = obj.optString("date", "").trim()
            // Contrat non respecté (id/kind/date) = ligne ignorée, pas de valeur devinée.
            if (id.isEmpty() || !ABSENCE_KINDS.contains(kind) || date.length < 10) continue
            absences.add(
                AbsenceUi(
                    id = id,
                    kind = kind,
                    date = date,
                    dateEnd = optBounded(obj, "dateEnd", 40),
                    subject = optBounded(obj, "subject", MAX_SUBJECT_CHARS),
                    motif = optBounded(obj, "motif", MAX_MOTIF_CHARS),
                    minutes = optMinutes(obj),
                    justified = if (obj.isNull("justified")) null else obj.optBoolean("justified"),
                    periodId = optBounded(obj, "periodId", 64),
                ),
            )
        }
        val periods = mutableListOf<PeriodCountUi>()
        val parr = root.optJSONArray("periods") ?: JSONArray()
        for (i in 0 until parr.length()) {
            val obj = parr.optJSONObject(i) ?: continue
            val periodId = obj.optString("periodId", "").trim()
            if (periodId.isEmpty()) continue
            periods.add(
                PeriodCountUi(
                    periodId = periodId,
                    name = optBounded(obj, "name", MAX_NAME_CHARS) ?: periodId,
                    absences = optInt(obj, "absences"),
                    late = optInt(obj, "late"),
                    minutes = optInt(obj, "missingMinutes"),
                ),
            )
        }
        AttendanceUi(absences.sortedByDescending { it.date }, periods.sortedBy { it.periodId })
    }
} catch (_: Exception) {
    AttendanceUi()
}

/** Payload /v1/punishments -> sanctions (motif/type obligatoires au contrat). */
fun punishmentsFrom(payload: String?): List<PunishmentUi> = try {
    if (payload == null) {
        emptyList()
    } else {
        val arr = JSONObject(payload).optJSONArray("punishments") ?: JSONArray()
        val out = mutableListOf<PunishmentUi>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val date = obj.optString("date", "").trim()
            val type = optBounded(obj, "type", 100)
            val motif = optBounded(obj, "motif", MAX_MOTIF_CHARS)
            if (date.length < 10 || type == null || motif == null) continue
            val gravity = optNumber(obj, "gravity")
            out.add(PunishmentUi(date, type, motif, gravity))
        }
        out.sortedByDescending { it.date }
    }
} catch (_: Exception) {
    emptyList()
}

/** "4h00" : minutes manquées, lisible sans unité ("45min" si < 1h). */
fun minutesLabel(minutes: Int): String =
    if (minutes < 60) "${minutes}min" else "${minutes / 60}h${(minutes % 60).toString().padStart(2, '0')}"

fun absenceKindLabel(kind: String): String = if (kind == "late") "Retard" else "Absence"

/** Sélecteur de période : null = toutes les périodes. */
fun absencesForPeriod(data: AttendanceUi, periodId: String?): List<AbsenceUi> =
    if (periodId == null) data.absences else data.absences.filter { it.periodId == periodId }

fun attendanceTotals(rows: List<AbsenceUi>): Pair<Int, Int> =
    Pair(rows.count { it.kind == "absence" }, rows.count { it.kind == "late" })

// --- Routes : une ressource cachable par écran, état UiState commun ---
// ponytail: coquille partagée (cache synchrone + refresh + repli hors-ligne)
//   identique à CanteenRoute/NewsRoute, factorisée ici pour deux ressources.
// #135 : le paramètre `title` (« Vie scolaire », « Sanctions ») et son
//   `Text(title)` ont disparu — la barre du haut porte le titre de la route
//   (cf. AppShell.kt), l'écran ne le répète plus. D'où les arguments NOMMÉS aux
//   deux appelants : deux `String` consécutives en positionnel se seraient
//   décalées en silence.
@Composable
private fun CachedSchoolRoute(
    repo: SyncedRepository,
    baseUrl: String,
    resource: String,
    subtitle: String,
    extraLabel: String? = null,
    onExtra: (() -> Unit)? = null,
    body: @Composable (String?) -> Unit,
) {
    var state by remember(resource) {
        val c = try {
            repo.cached(resource)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(uiStateFromCache(c, c != null && repo.isStale(resource, c)))
    }
    fun refresh() {
        // Serveur non configuré : pas d'appel (I1).
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            return
        }
        state = when (val s = state) {
            // Re-affichage cache pendant reload (pas de spinner si données).
            is UiState.Data -> s
            is UiState.Error -> if (s.cached != null) UiState.Data(s.cached, true, 0L) else UiState.Loading
            else -> UiState.Loading
        }
        try {
            repo.refreshAsync(resource, baseUrl) { o -> state = uiStateFromOutcome(o) }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
        }
    }
    val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(subtitle, style = MaterialTheme.typography.titleMedium)
        if ((state as? UiState.Data)?.isStale == true) Text("Données hors-ligne (périmé).")
        if (state is UiState.Loading) Text("Chargement…")
        if (state is UiState.Error) Text("Erreur réseau. Réessayer.")
        if (payload == null && state is UiState.Empty) Text("Aucune donnée en cache. Actualisez.")
        body(payload)
        Button(onClick = { refresh() }) { Text("Actualiser") }
        if (extraLabel != null && onExtra != null) Button(onClick = onExtra) { Text(extraLabel) }
    }
}

// @OptIn: FilterChip.material3 tant qu'il reste annoté Expérimental.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttendanceRoute(repo: SyncedRepository, baseUrl: String, onSanctions: () -> Unit = {}) {
    var periodId by remember { mutableStateOf<String?>(null) }
    CachedSchoolRoute(
        repo = repo,
        baseUrl = baseUrl,
        resource = CachePolicy.ATTENDANCE,
        subtitle = "Absences et retards",
        extraLabel = "Sanctions",
        onExtra = onSanctions,
    ) { payload ->
        val data = attendanceFrom(payload)
        val rows = absencesForPeriod(data, periodId)
        val totals = attendanceTotals(rows)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            FilterChip(selected = periodId == null, onClick = { periodId = null }, label = { Text("Toutes") })
            for (p in data.periods) {
                FilterChip(
                    selected = periodId == p.periodId,
                    onClick = { periodId = if (periodId == p.periodId) null else p.periodId },
                    label = { Text(p.name) },
                )
            }
        }
        for (p in data.periods) {
            Text("${p.name} : ${p.absences} absence(s), ${p.late} retard(s), ${minutesLabel(p.minutes)}")
        }
        Text("Absences : ${totals.first} · Retards : ${totals.second}")
        if (rows.isEmpty()) {
            // Capacite dynamique : aucune presence publiee = etat vide propre.
            Text("Aucune absence ni retard.")
        } else {
            for (row in rows) {
                val span = if (row.dateEnd != null) "${row.date} → ${row.dateEnd}" else row.date
                val subject = row.subject?.let { " en $it" } ?: ""
                val minutes = row.minutes?.let { " (${minutesLabel(it)})" } ?: ""
                val justified = row.justified?.let { if (it) " · justifiée" else " · non justifiée" } ?: ""
                Text("${absenceKindLabel(row.kind)} $span$subject$minutes$justified")
                // Donnee etablissement ci-dessous : affichee telle quelle, jamais executee (I6).
                if (row.motif != null) Text(row.motif)
            }
        }
    }
}

@Composable
fun PunishmentsRoute(repo: SyncedRepository, baseUrl: String, onBack: () -> Unit = {}) {
    CachedSchoolRoute(
        repo = repo,
        baseUrl = baseUrl,
        resource = CachePolicy.PUNISHMENTS,
        subtitle = "Punitions vie scolaire",
        extraLabel = "Retour",
        onExtra = onBack,
    ) { payload ->
        val rows = punishmentsFrom(payload)
        if (rows.isEmpty()) {
            Text("Aucune sanction publiée.")
        } else {
            for (row in rows) {
                val gravity = row.gravity?.let { " (gravité $it)" } ?: ""
                Text("${row.date} · ${row.type}$gravity")
                Text(row.motif)
            }
        }
    }
}
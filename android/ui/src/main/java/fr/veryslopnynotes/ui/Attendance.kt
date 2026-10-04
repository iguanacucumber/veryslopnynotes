package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SubjectPrefs
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
//
// #141 : ce fichier ne fait plus que LIRE le contrat et TENIR L'ÉTAT. Le rendu
// est dans `AttendanceRows.kt`, la logique pure dans `AttendanceFormat.kt`.
// Ce qui a disparu d'ici : la ligne concaténée par événement (date ISO brute,
// aucune couleur) et les compteurs doublés. Ce qui est arrivé : `/v1/periods`
// (liste complète des tranches, comme l'onglet Notes), la porte sur
// `Capabilities.PUNISHMENTS`, et un conteneur de défilement.

private const val MAX_MOTIF_CHARS = 500
private const val MAX_SUBJECT_CHARS = 64
private const val MAX_NAME_CHARS = 100
private val ABSENCE_KINDS = listOf("absence", "late")

/** Libellé de la vue « année entière » (aucune tranche choisie). */
private const val ALL_PERIODS_LABEL = "Année"

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

// --- Routes : une ressource cachable par écran, état UiState commun ---
// #141 : le rendu est restructuré (carte de statut, sections, cartes d'événement)
//   et sort de ce fichier, qui ne garde que la LECTURE du contrat ; la logique
//   pure est dans `AttendanceFormat.kt`, les briques visuelles dans
//   `AttendanceRows.kt`. Ce qui changeait de toute façon :
//   - `subtitle` (« Absences et retards », « Punitions vie scolaire ») : le
//     titre de la route est dans la barre du haut depuis #135, le corps le
//     répétait en 16 sp gras juste dessous ;
//   - `extraLabel` / `onExtra` (« Sanctions », « Retour ») : des liens de
//     navigation en clair dans le corps d'un écran. « Retour » disparaît — la
//     route Sanctions a sa flèche dans la barre (cf. `TOP_BARS`) — et « Sanctions »
//     devient une capacité (#87), pas un bouton permanent ;
//   - le rendu des états : « Chargement… », « Erreur réseau. Réessayer. » (le
//     VRAI message du serveur était JETÉ) et « Données hors-ligne (périmé). »
//     (sans horodatage) sont remplacés par `PapLoading`, `PapErrorState`,
//     `PapEmptyState` et `PapStaleBanner` ;
//   - la page a enfin un conteneur de défilement : la liste des événements pouvait
//     déborder de l'écran sans qu'on puisse l'atteindre.
//
// ponytail: coquille partagée (cache synchrone + refresh + repli hors-ligne)
//   identique à CanteenRoute/NewsRoute, factorisée ici pour deux ressources.
// ponytail: `body` reçoit le PAYLOAD et le `refresh`, et rien d'autre : l'état
//   reste dans la coquille, donc un écran ne peut pas afficher un état au milieu
//   d'une page de contrôles (#162).

/**
 * Coquille des deux écrans « vie scolaire » : cache synchrone au premier rendu,
 * relecture réseau, repli hors-ligne, et les quatre ÉTATS possibles.
 *
 * [body] reçoit le payload affiché (jamais la chaîne JSON rendue) et le geste de
 * relecture. Elle n'est PAS appelée quand il n'y a rien à montrer : un écran sans
 * donnée est un état unique (message + une action), pas une page de contrôles
 * au-dessus du vide.
 */
@Composable
private fun CachedSchoolRoute(
    repo: SyncedRepository,
    baseUrl: String,
    resource: String,
    refreshTick: Int = 0,
    body: @Composable (String?, () -> Unit) -> Unit,
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
            // Ré-affichage cache pendant reload (pas de spinner si données).
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
    // Cache affiché d'abord, relecture ensuite (offline-first #14). Le compteur
    // de la barre du haut rejoue le même effet (#162).
    LaunchedEffect(resource, refreshTick) { refresh() }

    val data = state as? UiState.Data
    // `state` est une propriété déléguée : elle n'est pas smart-castable dans le
    // lambda de contenu, donc l'erreur est extraite une fois ici.
    val error = state as? UiState.Error
    val payload = data?.payload ?: error?.cached
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (payload == null) {
            // Un écran SANS donnée : squelette, vide, ou le VRAI message du
            // serveur avec son « Réessayer ». Rien d'autre sous le message.
            when (state) {
                UiState.Loading -> PapLoading()
                UiState.Empty -> PapEmptyState(
                    icon = Icons.Filled.Info,
                    title = "Aucune donnée en cache",
                    description = "Actualisez pour lire les données de l'établissement.",
                    action = { Button(onClick = { refresh() }) { Text("Actualiser") } },
                )
                is UiState.Error -> PapErrorState(message = error?.message, onRetry = { refresh() })
                is UiState.Data -> Unit
            }
            return@Column
        }
        if (data != null && data.isStale) {
            PapStaleBanner(fetchedAt = data.fetchedAt, onRefresh = { refresh() })
        }
        // Échec de la RELECTURE alors que le cache est là : les lignes restent
        // affichées, la cause est dite en une ligne (le gros bloc rouge, avec son
        // « Réessayer », doublerait l'action de l'en-tête).
        if (error != null) {
            Text(
                text = error.message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        body(payload) { refresh() }
    }
}

/**
 * Capacités publiées, lues UNE fois par entrée dans l'écran.
 *
 * `repo.cached` lit un FICHIEL : le lire à chaque recomposition serait du travail
 * pour rien. `remember` sans clé a exactement la bonne durée de vie — relu à
 * chaque entrée dans la route, donc après une détection d'onglets faite depuis
 * le Profil. `Capabilities.visible(null, …)` = `true` : rien n'affirmé => rien
 * n'est masqué.
 */
private fun sanctionsAllowed(repo: SyncedRepository): Boolean {
    val payload = try {
        repo.cached(CachePolicy.CAPABILITIES)?.payload
    } catch (_: Exception) {
        null
    }
    return Capabilities.visible(Capabilities.parse(payload), Capabilities.PUNISHMENTS)
}

/**
 * Onglet « Vie scolaire » : carte de statut, sélecteur de période DÉFILABLE,
 * sections « Absences » / « Retards », une carte par événement.
 *
 * [subjectPrefs] alimente le résolveur de matière (#83/#139) : sans prefs, la
 * couleur vient du nom, donc la colonne vertébrale d'une matière est la même
 * partout. [onSanctions] n'est une destination QUE si l'établissement publie
 * l'onglet `punishments` (#87) — sinon le bouton n'existe pas, comme les entrées
 * de navigation masquées du Profil.
 *
 * @param refreshTick relecture demandée par la barre du haut (#162) ; la barre
 *   n'a pas de slot `Refresh` pour cette route, donc il reste à 0 et le bouton
 *   d'en-tête fait le même travail.
 */
@Composable
fun AttendanceRoute(
    repo: SyncedRepository,
    baseUrl: String,
    onSanctions: () -> Unit = {},
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    refreshTick: Int = 0,
) {
    // UNE horloge pour toute la page : « il y a 4 jours » ne doit pas changer
    // d'une ligne à l'autre. Relue à chaque nouveau payload (donc à chaque
    // relecture), sinon un écran laissé ouvert vieillit ses propres libellés.
    var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    var periodId by remember { mutableStateOf<String?>(null) }
    var periodsOpen by remember { mutableStateOf(false) }
    var periods by remember { mutableStateOf(emptyList<PeriodUi>()) }
    var periodsError by remember { mutableStateOf<String?>(null) }
    // Une lecture de fichier par ENTRÉE dans l'écran, pas par recomposition.
    val sanctionsVisible = remember(repo) { sanctionsAllowed(repo) }

    /**
     * Tranches de l'établissement : le même appel que l'onglet Notes (#139),
     * hors cache (elles changent une fois par an). Son échec est affiché tel
     * quel, et le sélecteur bascule alors sur les compteurs du payload.
     */
    fun loadPeriods() {
        if (baseUrl.isBlank()) return
        try {
            repo.fetchPeriods(baseUrl) { o ->
                when (o) {
                    is RefreshOutcome.Updated -> {
                        periods = periodsFrom(o.payload)
                        periodsError = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        periods = periodsFrom(o.payload)
                        periodsError = null
                    }
                    is RefreshOutcome.Failed -> periodsError = o.message
                }
            }
        } catch (_: Exception) {
            periodsError = "Tranches indisponibles."
        }
    }

    LaunchedEffect(baseUrl) { loadPeriods() }

    CachedSchoolRoute(
        repo = repo,
        baseUrl = baseUrl,
        resource = CachePolicy.ATTENDANCE,
        refreshTick = refreshTick,
    ) { payload, refresh ->
        LaunchedEffect(payload) { nowMillis = System.currentTimeMillis() }
        val data = attendanceFrom(payload)
        val rows = absencesForPeriod(data, periodId)
        val sections = attendanceSections(rows)
        val status = attendanceStatus(rows)
        // `/v1/periods` pour la liste complète, les compteurs du payload pour les
        // chiffres ; sans tranches, la coquille des compteurs suffit.
        val tranches = remember(periods, data.periods) { attendancePeriods(periods, data.periods) }
        val chips = remember(tranches) { tranches.map { it.period } }
        val selected = tranches.firstOrNull { it.id == periodId }

        AttendanceHeader(
            periodName = selected?.name ?: ALL_PERIODS_LABEL,
            periodNumber = selected?.let { periodNumberLabel(it.name) },
            expanded = periodsOpen,
            onToggle = { periodsOpen = !periodsOpen },
            onRefresh = refresh,
        )
        if (periodsOpen) {
            GradesPeriodChips(periods = chips, selectedId = periodId, onSelect = { periodId = it })
            val failure = periodsError
            if (failure != null) {
                Text(
                    text = failure,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        // Étendue de la tranche choisie (« Trimestre 1 · 01/09/2026 – 30/11/2026 »),
        // seulement quand `/v1/periods` a publié des bornes. Les COMPTEURS, eux,
        // sont dans les titres de section : une seule fois, pas deux (avant #141,
        // ils étaient doublés — une ligne par période, puis une ligne de totaux).
        if (selected != null && (selected.startMillis != null || selected.endMillis != null)) {
            Text(
                text = periodLabel(selected.period),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (sections.isEmpty()) {
            // Aucun événement : UNE carte d'état, pas une carte de statut qui
            // annoncerait « aucune heure injustifiée » au-dessus d'un vide.
            PapEmptyState(
                icon = Icons.Filled.CheckCircle,
                title = "Aucune absence ni retard",
                description = "L'établissement n'a rien publié sur cette période.",
                action = { Button(onClick = { refresh() }) { Text("Actualiser") } },
            )
        } else {
            AttendanceStatusCard(status = status)
            AttendanceSections(
                sections = sections,
                subjectPrefs = subjectPrefs,
                nowMillis = nowMillis,
            )
        }
        // #87 : Sanctions est une CAPACITÉ, pas un bouton permanent — un
        // établissement qui n'active pas l'onglet ne voit pas la destination.
        // #162 veut les destinations dans la barre du haut (`TOP_BAR_ACTIONS`),
        // qui est le seul endroit qui sait nouer `onNavigate` ET la capacité ;
        // ce bouton est donc le repli explicite tant que cette entrée n'existe
        // pas — et il ne sort qu'avec des données, jamais sous un état d'erreur.
        if (sanctionsVisible) {
            Button(onClick = onSanctions) { Text("Sanctions") }
        }
    }
}

/**
 * Écran « Sanctions » : une carte par sanction, sans date ISO ni gravité nue.
 *
 * [onBack] n'est plus câblé dans le corps : la route a sa flèche de retour dans
 * la barre du haut (`TOP_BARS`, cf. `AppShell.kt`), donc un bouton « Retour »
 * sous la liste était un doublon. Le paramètre reste parce que `AppNav.kt` le
 * passe — le retirer serait un changement hors périmètre de cet écran.
 */
@Suppress("UNUSED_PARAMETER")
@Composable
fun PunishmentsRoute(
    repo: SyncedRepository,
    baseUrl: String,
    onBack: () -> Unit = {},
    refreshTick: Int = 0,
) {
    var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    CachedSchoolRoute(
        repo = repo,
        baseUrl = baseUrl,
        resource = CachePolicy.PUNISHMENTS,
        refreshTick = refreshTick,
    ) { payload, refresh ->
        LaunchedEffect(payload) { nowMillis = System.currentTimeMillis() }
        val rows = remember(payload) { punishmentsFrom(payload) }
        if (rows.isEmpty()) {
            PapEmptyState(
                icon = Icons.Filled.Warning,
                title = "Aucune sanction publiée",
                description = "L'établissement n'a publié aucune sanction.",
                action = { Button(onClick = { refresh() }) { Text("Actualiser") } },
            )
        } else {
            for (row in rows) {
                PunishmentCard(row = row, nowMillis = nowMillis)
            }
        }
    }
}

package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.AssignmentsRepository
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SyncedRepository
import fr.veryslopnynotes.data.TokenStore

// Onglet Tâches #75 (parité Papillon) : devoirs groupés par jour de la semaine
// demandée, contenus de cours + pièces jointes via le PROXY SERVEUR.
// Toggle Optimiste : l'affichage bascule tout de suite, retour arrière si le
// serveur refuse (401 session expirée / 409 inconnu / 501 non supporté / réseau).
// Pull-refresh = bouton "Actualiser" (déjà le.refreshAsync + cache offline-first).
// Contenu serveur = DONNÉE affichée par Text() seul (I6) ; pièce jointe = URL du
// proxy /v1/media, aucune URL Pronote/ENT dans l'app (I1).

fun assignmentsFromPayload(payload: String?): List<Assignment> = try {
    if (payload == null) emptyList() else AssignmentsRepository.parse(payload)
} catch (_: Exception) {
    emptyList()
}

// Regroupement par jour de dueDate (ordre du contrat conservé) : le "badge
// semaine" est dérivé de l'ISO, jamais stocké ni calculé par le serveur.
fun assignmentsByDay(list: List<Assignment>): List<Pair<String, List<Assignment>>> {
    val byDay = linkedMapOf<String, MutableList<Assignment>>()
    for (a in list) {
        val day = Assignment.dayLabel(a.dueDate)
        if (day.isEmpty()) continue
        byDay.getOrPut(day) { mutableListOf() }.add(a)
    }
    return byDay.entries.sortedBy { it.key }.map { it.key to it.value.toList() }
}

@Composable
fun AssignmentsScreen(
    days: List<Pair<String, List<Assignment>>>,
    accountId: String,
    baseUrl: String,
    isLoading: Boolean = false,
    isStale: Boolean = false,
    error: String? = null,
    notice: String? = null,
    onRetry: () -> Unit = {},
    onToggle: (Assignment, Boolean) -> Unit = { _, _ -> },
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Tâches")
        Text("Devoirs de la semaine")
        if (isStale) Text("Données hors-ligne (périmé).")
        if (notice != null) Text(notice)
        when {
            isLoading && days.isEmpty() -> Text("Chargement…")
            error != null && days.isEmpty() -> {
                Text("Erreur réseau. Réessayer.")
                Button(onClick = onRetry) { Text("Réessayer") }
            }
            days.isEmpty() -> Text("Aucun devoir.")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((day, items) in days) {
                    item(key = "jour-$day") { Text(Assignment.dayLabelFr(day)) }
                    items(items, key = { it.id }) { a ->
                        AssignmentCard(a, accountId, baseUrl, onToggle)
                    }
                }
            }
        }
        Button(onClick = onRetry) { Text("Actualiser") }
    }
}

@Composable
private fun AssignmentCard(
    a: Assignment,
    accountId: String,
    baseUrl: String,
    onToggle: (Assignment, Boolean) -> Unit,
) {
    Card {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("${Assignment.dayLabelFr(a.dueDate)} · ${a.subject}")
            Text(a.title)
            // Consigne du devoir : texte enseignant affiché tel quel (donnée).
            if (a.description.isNotBlank()) Text(a.description)
            val lc = a.lessonContent
            if (lc != null) {
                Text("Contenu de cours : ${lc.title}")
                if (lc.excerpt.isNotBlank()) Text(lc.excerpt)
            }
            for (att in a.attachments) {
                // Téléchargement via le proxy serveur : l'URL n'est jamais celle de l'ENT.
                // ponytail: URL affichée telle quelle, pas d'Intent ACTION_VIEW tant que
                // le téléchargement n'a pas été demandé. Upgrade: Intent sur cette URL
                // de proxy (et JAMAIS sur une URL Pronote/ENT, I1).
                val url = AssignmentsRepository.mediaUrl(baseUrl, accountId, att.ref)
                Text("Pièce jointe : ${att.label} — ${url}")
            }
            Button(onClick = { onToggle(a, !a.done) }) {
                Text(if (a.done) "Marquer non fait" else "Marquer fait")
            }
        }
    }
}

// Route câblée sur SyncedRepository (ressource "assignments", TTL 15 min) :
// cache synchrone au démarrage, refresh réseau, repli cache hors-ligne.
// ponytail: le filtre semaine est servi par GET /v1/assignments?weekStart= ; la
// navigation semaine par semaine (swipe) arrive avec le calendrier (#76), pas de
// sélecteur_local ici.
@Composable
fun AssignmentsRoute(
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    accountId: String,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // Bearer du device appairé (contrat 0.4.0), relu à chaque requête.
    tokens: TokenStore? = null,
) {
    val api = remember(baseUrl, tokens) { ApiClient(baseUrl, tokens = tokens) }
    val toggleRepo = remember(api) { AssignmentsRepository(api) }
    var state by remember {
        val c = try {
            repo.cached(resource)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(uiStateFromCache(c, c != null && repo.isStale(resource, c)))
    }
    // Toggle Optimiste : on patche la liste affichée, revert sur échec.
    var pending by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    fun refresh() {
        // Serveur non configuré : aucun appel (I1).
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            return
        }
        state = when (val s = state) {
            is UiState.Data -> s
            else -> UiState.Loading
        }
        try {
            repo.refreshAsync(resource, baseUrl) { o ->
                state = uiStateFromOutcome(o)
                // Le payload fait foi : l'état optimiste n'est plus nécessaire.
                if (o !is RefreshOutcome.Failed) pending = null
            }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
            pending = null
        }
    }
    LaunchedEffect(Unit) { refresh() }
    val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
    val list = assignmentsFromPayload(payload)
    val optimistic = pending?.let { (id, done) -> list.map { if (it.id == id) it.copy(done = done) else it } } ?: list
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // #83 : prefs matière du résolveur unique (légende couleur/emoji/libellé).
        payload?.let { SubjectLegend(subjectsFromPayload(it), subjectPrefs) }
        AssignmentsScreen(
            days = assignmentsByDay(optimistic),
            accountId = accountId,
            baseUrl = baseUrl,
            isLoading = state is UiState.Loading,
            isStale = (state as? UiState.Data)?.isStale == true,
            error = (state as? UiState.Error)?.message,
            notice = notice,
            onRetry = { refresh() },
            onToggle = { a, done ->
                pending = a.id to done
                notice = null
                toggleRepo.toggle(baseUrl, a.id, done) { o ->
                    if (o.assignment == null) {
                        // Retour arrière immédiat : l'affichage revient au cache.
                        pending = null
                        notice = o.error
                    } else {
                        // Succès : resync du cache (invalidation par événement), l'état
                        // optimiste reste affiché jusqu'à l'arrivée du payload à jour.
                        notice = null
                        refresh()
                    }
                }
            },
        )
    }
}
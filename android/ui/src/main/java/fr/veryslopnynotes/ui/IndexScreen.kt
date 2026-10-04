package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.SyncedRepository

// Accueil #82 : widgets sur caches existants, données STRUCTURÉES du contrat
// (helpers testables dans HomeWidgets.kt). Aucune requête ajoutée : l'accueil
// reste offline-first (cache d'abord), et un cache absent = état vide propre.
//
// #135 : ce composable SORT d'`AppNav.kt` (qui faisait 970 lignes et portait la
// coquille ET quatre écrans : tout le monde se disputait le même fichier).
// Comportement inchangé, SAUF deux retouches de coquille :
//   - `Text("Accueil")` retiré : la barre du haut affiche le titre de la route
//     (papillon.bzh), le nom de l'écran ne doit plus être lu deux fois ;
//   - les titres de section passent à `MaterialTheme.typography.titleMedium`,
//     le seul style que #134 a livré et qu'aucun écran n'utilisait.
// REDESIGN : #143 (accueil : tableau de bord à widgets). Ne pas le commencer
// avant d'avoir lu cette fiche — le `ponytail:` ci-dessous vaut pour l'ancien
// code, pas pour le nouveau.
@Composable
fun IndexScreen(
    repo: SyncedRepository,
    goCalendar: () -> Unit,
    goGrades: () -> Unit,
    goTasks: () -> Unit,
) {
    // ponytail: lecture synchrone des 3 caches (pas de ViewModel avant besoin).
    val grades = try { repo.cached(CachePolicy.GRADES) } catch (_: Exception) { null }
    val assignments = try { repo.cached(CachePolicy.ASSIGNMENTS) } catch (_: Exception) { null }
    val timetable = try { repo.cached(CachePolicy.TIMETABLE) } catch (_: Exception) { null }
    // Horodatage ISO commun aux tris « à venir ». Les dates du contrat sont en UTC
    // (.000Z) : on formate donc explicitement en UTC, sinon le fuseau du téléphone
    // décalerait le « maintenant » et masquerait le cours en cours.
    val nowIso = try {
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.FRANCE)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())
    } catch (_: Exception) {
        ""
    }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (grades == null && assignments == null && timetable == null) {
            Text("Aucune donnée en cache. Appairez puis actualisez un onglet.")
        } else {
            if (timetable != null && repo.isStale(CachePolicy.TIMETABLE, timetable)) {
                Text("Données hors-ligne (périmé).")
            }
            val lessons = timetable?.payload?.let { upcomingLessonsFrom(it, nowIso) } ?: emptyList()
            if (lessons.isEmpty()) {
                Text("Prochain cours : pas de cours à venir.")
            } else {
                Text("Prochain cours", style = MaterialTheme.typography.titleMedium)
                for (l in lessons) {
                    val room = if (l.room.isEmpty()) "" else " — ${l.room}"
                    Text("${homeTimeLabel(l.start)} · ${l.subject}$room")
                }
            }
            Button(onClick = goCalendar) { Text("Ouvrir l'EDT") }

            val homework = assignments?.payload?.let { pendingHomeworkFrom(it, nowIso) } ?: emptyList()
            if (homework.isEmpty()) {
                Text("Devoirs : rien à rendre.")
            } else {
                Text("Devoirs", style = MaterialTheme.typography.titleMedium)
                for (h in homework) {
                    Text("${homeTimeLabel(h.dueDate)} · ${h.subject} — ${h.title}")
                }
            }
            Button(onClick = goTasks) { Text("Ouvrir les tâches") }

            val latest = grades?.payload?.let { latestGradesFrom(it) } ?: emptyList()
            if (latest.isEmpty()) {
                Text("Dernières notes : aucune note en cache.")
            } else {
                Text("Dernières notes", style = MaterialTheme.typography.titleMedium)
                for (g in latest) {
                    Text("${g.subject} : ${g.note}")
                }
            }
            Button(onClick = goGrades) { Text("Ouvrir les notes") }
        }
    }
}
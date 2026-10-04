package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SyncedRepository
import kotlinx.coroutines.delay
import java.time.ZoneId

// ACCUEIL À WIDGETS #143 (Papillon).
//
// AVANT (`IndexScreen.kt` #82) : un DIGEST DE TEXTE. Des libellés de section,
// des lignes en pleine largeur, trois boutons « Ouvrir l'EDT / les tâches /
// les notes ». Conséquences réelles :
//   - rien n'était cliquable SAUF ces trois boutons — un cours, une note, un
//     devoir ne menaient nulle part ;
//   - la racine était un `Column` en `fillMaxSize` SANS défilement : une
//     semaine de contenu débordait et était TRONQUÉ, sans retour possible ;
//   - `HomeLessonUi.end` (l'heure de FIN) et `HomeGradeUi.date` étaient analysés
//     puis jamais affichés ;
//   - aucune date relative (« dans 12 min »), aucun compte à rebours ;
//   - le bandeau périmé se réduisait au mot « périmé », sans l'âge des données.
//
// MAINTENANT : une liste verticale de cartes widgets (prochain cours, moyenne,
// devoirs du jour), la grille 2×2 des accès rapides, chaque carte cliquable, le
// défilement, le bandeau « mis à jour il y a 4 min » et le tirail pour
// actualiser. Habillage : `HomeCards.kt`. Données : `HomeWidgets.kt`.
//
// HORS-LIGNE D'ABORD (#14, inchangé) : la page lit les CACHES et n'affiche
// jamais un écran nu — une actualisation qui échoue laisse la page en place et
// ne fait que signaler l'âge des données. Le seul moment où l'accueil déclenche
// du réseau est le TIRAIL, qui ne remplace jamais le contenu affiché.
//
// Le titre du haut (« Accueil ») reste dans la barre du haut (#135) : il n'est
// pas répété ici. Pas de bandeau photo ni d'avatar : le profil n'est PAS une
// ressource cachable (testé : `CACHEABLE_RESOURCES` ne contient pas `me`), donc
// l'afficher ici ajouterait une requête réseau à la page la plus consultée et
// casserait l'affichage hors-ligne — et une pastille sans nom ne ferait que
// doubler le titre de la barre.
@Composable
fun IndexScreen(
    repo: SyncedRepository,
    baseUrl: String = "",
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    onOpen: (String) -> Unit = {},
) {
    val zone = remember { ZoneId.systemDefault() }
    // `nowMillis` est relu chaque minute : l'accueil est le seul écran qui
    // affiche un compte à rebours, et « dans 12 min » deviendrait FAUX au bout
    // d'une minute sans tic.
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    // Le cache est la vérité : un rafraîchissement ne fait qu'incrémenter ce
    // compteur, et la page relit les fichiers. Zéro état de données dupliqué,
    // donc aucune incohérence possible entre ce qui est affiché et le cache.
    var revision by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var refreshError by remember { mutableStateOf<String?>(null) }
    val snapshot = remember(repo, revision) { homeSnapshotFrom(repo) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(HOME_TICK_MS)
            nowMillis = System.currentTimeMillis()
        }
    }

    /**
     * Tirail (et bouton du bandeau) : recharge les trois ressources que la page
     * Affiche. Un échec NE REMPLACE PAS la page : le cache est relu tel quel et
     * le bandeau continue d'annoncer son âge — c'est le repli de #14, pas un
     * écran d'erreur au-dessus de données encore bonnes.
     */
    fun refresh() {
        if (baseUrl.isBlank() || refreshing) return
        refreshing = true
        refreshError = null
        var pending = HOME_WIDGET_RESOURCES.size
        fun done(message: String?) {
            pending -= 1
            if (message != null) refreshError = message
            if (pending > 0) return
            refreshing = false
            revision += 1
            nowMillis = System.currentTimeMillis()
        }
        for (resource in HOME_WIDGET_RESOURCES) {
            try {
                repo.refreshAsync(resource, baseUrl) { outcome ->
                    done((outcome as? RefreshOutcome.Failed)?.message)
                }
            } catch (_: Exception) {
                done(null)
            }
        }
    }

    val lessons = snapshot.timetable?.let { upcomingLessonsFrom(it, nowMillis) }.orEmpty()
    val homework = snapshot.assignments?.let { pendingHomeworkFrom(it, nowMillis) }.orEmpty()
    val grades = snapshot.grades?.let { latestGradesFrom(it, limit = 1) }.orEmpty()
    // #139 a livre le rapport de moyennes (`averagesFrom`) : l'accueil prend la
    // moyenne generale de la, sans relire le JSON des moyennes.
    val average = generalAverageOf(snapshot.grades?.let { averagesFrom(it) })
    val actions = homeQuickActions(
        snapshot.news,
        snapshot.menus,
        snapshot.attendance,
        snapshot.discussions,
        nowMillis,
        zone,
    )
    val cachedActions = listOf(snapshot.news, snapshot.menus, snapshot.attendance, snapshot.discussions)
        .count { it != null }

    HomePullToRefresh(refreshing = refreshing, onRefresh = { refresh() }) {
        Column(
            // #143 : le défilement était le défaut le plus visible. `fillMaxSize`
            // + `verticalScroll` : une semaine de contenu se fait défiler au
            // lieu d'être tronquée.
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Périmé, OU dernière actualisation ratée : dans les deux cas ce qui
            // est affiché vient du CACHE, et l'utilisateur doit l'apprendre. Le
            // libellé du bandeau est celui de #136 (« Données hors-ligne · mis à
            // jour il y a 4 min ») : les deux plans disent la même chose.
            if (snapshot.stale || refreshError != null) {
                PapStaleBanner(fetchedAt = snapshot.fetchedAt, onRefresh = { refresh() })
            }
            HomeQuickActionsGrid(actions = actions, onOpen = onOpen)
            val empty = !homeHasContent(lessons, average, homework, cachedActions)
            when {
                // Tirail sur une page vide : le cache est relu à la fin, donc
                // l'indicateur est l'information honnête (pas un écran vide qui
                // laisse croire à un échec).
                empty && refreshing -> PapLoadingBlock()
                empty -> PapEmptyState(
                    icon = Icons.Filled.Info,
                    title = "Rien à afficher",
                    description = refreshError
                        ?: "Aucune donnée en cache. Appairez puis actualisez un onglet.",
                )
            }

            // --- Widget cours : la carte elle-même ouvre l'EDT -------------
            if (lessons.isNotEmpty()) {
                HomeWidgetCard(
                    icon = Icons.Filled.DateRange,
                    title = homeCourseTitle(lessons, nowMillis, zone),
                    onClick = { onOpen(ROUTE_CALENDAR) },
                    onMore = { onOpen(ROUTE_CALENDAR) },
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (lesson in lessons) {
                            HomeCourseCard(
                                lesson = lesson,
                                zone = zone,
                                subjectPrefs = subjectPrefs,
                                countdown = relativeTimeFr(lesson.startMillis, nowMillis),
                            )
                        }
                    }
                }
            }

            // --- Widget moyenne : le grand nombre, puis la dernière note ----
            // La moyenne GÉNÉRALE n'appartient à aucune matière (le contrat ne
            // publie qu'un `averages.general`), donc elle porte la couleur de
            // marque, pas une couleur de matière inventée ; c'est la ligne de la
            // dernière note qui prend la couleur de SA matière — et sa date,
            // enfin affichée (#82 la triait sans la montrer).
            if (average != null || grades.isNotEmpty()) {
                HomeWidgetCard(
                    icon = Icons.Filled.Star,
                    title = "Moyenne",
                    onClick = { onOpen(ROUTE_GRADES) },
                    onMore = { onOpen(ROUTE_GRADES) },
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (average != null) {
                            Row(verticalAlignment = Alignment.Bottom) {
                                Text(
                                    text = homeAverageNumberLabel(average.value),
                                    style = MaterialTheme.typography.displaySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                Text(
                                    text = "/20",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(start = 4.dp, bottom = 4.dp),
                                )
                            }
                            Text(
                                text = if (average.provided) "Moyenne fournie" else "Moyenne estimée",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        for (grade in grades) {
                            val style = subjectStyle(subjectPrefs, grade.subject)
                            val hex = style.colorHex.orEmpty()
                            val ink = subjectContent(hex) ?: MaterialTheme.colorScheme.primary
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    text = style.badge,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(text = grade.note, style = MaterialTheme.typography.titleSmall)
                                Text(
                                    text = relativeTimeFr(grade.dateMillis, nowMillis),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }

            // --- Widget devoirs : échéance en temps relatif ------------------
            if (homework.isNotEmpty()) {
                HomeWidgetCard(
                    icon = Icons.Filled.CheckCircle,
                    title = "Devoirs",
                    onClick = { onOpen(ROUTE_TASKS) },
                    onMore = { onOpen(ROUTE_TASKS) },
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (task in homework) {
                            val style = subjectStyle(subjectPrefs, task.subject)
                            val hex = style.colorHex.orEmpty()
                            val ink = subjectContent(hex) ?: MaterialTheme.colorScheme.primary
                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Text(
                                        text = style.badge,
                                        style = MaterialTheme.typography.titleSmall,
                                        color = ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Box(modifier = Modifier.padding(top = 2.dp)) {
                                        PapPill(
                                            text = relativeTimeFr(task.dueMillis, nowMillis),
                                            color = colorFromHex(hex) ?: MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                Text(
                                    text = task.title,
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Une minute, en millisecondes : le tic du compteur à rebours de l'accueil. */
private const val HOME_TICK_MS = 60_000L
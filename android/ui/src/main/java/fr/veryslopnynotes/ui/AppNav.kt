package fr.veryslopnynotes.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.FileSubjectPrefsStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.InMemorySubjectPrefsStore
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SubjectPrefsRepository
import fr.veryslopnynotes.data.SyncedRepository

// Parité Papillon #86 : 5 onglets (index, calendar, grades, tasks, profile)
// + settings. Routes secondaires hors onglets : pairing, alerts, fiches.
// Offline-first #14 : lecture synchrone du cache au demarrage (jamais de
// spinner si cache dispo), refresh reseau en echec = repli cache.
// Badge "perime" via CachePolicy (miroir contrats cache phase 5).
// Appairage QR+PIN #15 : route "pairing" (PairingRoute), token chiffré.
// Alertes sécurité #21 : route "alerts" (SecurityAlertsRoute, I6).
// Fiches révision #30 : route "fiches" (RevisionSheetsScreen).
// Préférences matière #83 : route "settings" (éditeur couleur/emoji/libellé),
// résolveur unique appliqué aux notes, devoirs et EDT (SubjectStyle.kt), offline
// via fichier local + réplication serveur (SubjectPrefs.kt).
// index/profile : coquilles parité (#82 profil/accueil branchera les données ici) ;
// aucun faux contenu. Contenu serveur affiché comme donnée, jamais interprété.

// ponytail: routes en const (pas de sealed class avant besoin #82/#83).
const val ROUTE_INDEX = "index"
const val ROUTE_CALENDAR = "calendar"
const val ROUTE_GRADES = "grades"
const val ROUTE_TASKS = "tasks"
const val ROUTE_PROFILE = "profile"
const val ROUTE_SETTINGS = "settings"
// #79/#81 : hors onglets comme "fiches" (capacités dynamiques : actualités et
// cantine n'apparaissent que si l'établissement publie la donnée).
const val ROUTE_NEWS = "news"
const val ROUTE_CANTEEN = "canteen"
// #77 : vie scolaire (absences/retards + sanctions), hors onglets comme
// "fiches" : apparaît seulement si l'établissement publie la donnée.
const val ROUTE_ATTENDANCE = "attendance"

private val TAB_ROUTES = listOf(ROUTE_INDEX, ROUTE_CALENDAR, ROUTE_GRADES, ROUTE_TASKS, ROUTE_PROFILE)

private fun tabLabel(route: String): String = when (route) {
    ROUTE_INDEX -> "Accueil"
    ROUTE_CALENDAR -> "Calendrier"
    ROUTE_GRADES -> "Notes"
    ROUTE_TASKS -> "Tâches"
    ROUTE_PROFILE -> "Profil"
    else -> route
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppNav(
    // ponytail: "" = non configuré (bouchon previews/tests sans BuildConfig).
    baseUrl: String = "",
    loadAlerts: suspend () -> List<SecurityAlert> = { emptyList() },
) {
    val nav = rememberNavController()
    val ctx = LocalContext.current.applicationContext
    // ponytail: fichier natif seul (pas de Room). Repli memoire si stockage KO.
    val repo = remember(baseUrl) {
        val store = try {
            FileCacheStore(java.io.File(ctx.filesDir, "offline"))
        } catch (_: Exception) {
            InMemoryCacheStore()
        }
        SyncedRepository(ApiClient(baseUrl), store)
    }
    // #83 : prefs matière = fichier local (survit au restart, lisible hors
    // ligne), répliqué vers le serveur allowlist seul (I1).
    val prefsRepo = remember(baseUrl) {
        val store = try {
            FileSubjectPrefsStore(java.io.File(ctx.filesDir, "offline/subject_prefs.json"))
        } catch (_: Exception) {
            InMemorySubjectPrefsStore()
        }
        SubjectPrefsRepository(ApiClient(baseUrl), store)
    }
    var subjectPrefs by remember { mutableStateOf(prefsRepo.prefs()) }
    val (theme, setTheme) = rememberAppTheme()
    val backStack by nav.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route
    // ponytail: deux schemes Material3 de base, appliqués une fois à la racine.
    val colorScheme = if (isDarkTheme(theme, isSystemInDarkTheme())) darkColorScheme() else lightColorScheme()
    MaterialTheme(colorScheme = colorScheme) {
    Scaffold(
        topBar = { TopAppBar(title = { Text("VerySlopyNyNotes") }) },
        bottomBar = {
            // ponytail: barre d'onglets seule (pas de badges notifs avant phase 7).
            NavigationBar {
                for (tab in TAB_ROUTES) {
                    NavigationBarItem(
                        selected = currentRoute == tab,
                        onClick = {
                            nav.navigate(tab) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        label = { Text(tabLabel(tab)) },
                        icon = { Text(tabIcon(tab)) },
                    )
                }
            }
        },
    ) { pad ->
        NavHost(
            navController = nav,
            startDestination = ROUTE_INDEX,
            modifier = Modifier.padding(pad),
        ) {
            composable(ROUTE_INDEX) {
                IndexScreen(repo, { nav.navigate(ROUTE_CALENDAR) }, { nav.navigate(ROUTE_GRADES) }, { nav.navigate(ROUTE_TASKS) })
            }
            composable(ROUTE_CALENDAR) {
                CachedScreen("Calendrier", CachePolicy.TIMETABLE, repo, baseUrl, "EDT semaine", { nav.navigate(ROUTE_SETTINGS) }, { nav.navigate("pairing") }, { nav.navigate("alerts") }, subjectPrefs = subjectPrefs)
            }
            composable(ROUTE_GRADES) {
                CachedScreen(
                    "Notes",
                    CachePolicy.GRADES,
                    repo,
                    baseUrl,
                    "Moyennes",
                    { nav.navigate(ROUTE_SETTINGS) },
                    { nav.navigate("pairing") },
                    { nav.navigate("alerts") },
                    showAverage = true,
                    subjectPrefs = subjectPrefs,
                    onCompetences = { nav.navigate("competences") },
                )
            }
            composable(ROUTE_TASKS) {
                CachedScreen("Tâches", CachePolicy.ASSIGNMENTS, repo, baseUrl, "Devoirs semaine", { nav.navigate(ROUTE_SETTINGS) }, { nav.navigate("pairing") }, { nav.navigate("alerts") }, subjectPrefs = subjectPrefs)
            }
            composable(ROUTE_PROFILE) {
                ProfileScreen(baseUrl, { nav.navigate(ROUTE_SETTINGS) }, { nav.navigate("pairing") }, { nav.navigate("alerts") }, { nav.navigate("fiches") }, { nav.navigate(ROUTE_NEWS) }, { nav.navigate(ROUTE_CANTEEN) }, { nav.navigate(ROUTE_ATTENDANCE) })
            }
            composable(ROUTE_NEWS) {
                NewsRoute(repo, baseUrl)
            }
            composable(ROUTE_CANTEEN) {
                CanteenRoute(repo, baseUrl)
            }
            // #77 : vie scolaire — absences/retards + compteurs par période,
            // puis sanctions (même ressource, écran secondaire).
            composable(ROUTE_ATTENDANCE) {
                AttendanceRoute(repo, baseUrl, onSanctions = { nav.navigate("sanctions") })
            }
            composable("sanctions") {
                PunishmentsRoute(repo, baseUrl, onBack = { nav.popBackStack() })
            }
            composable(ROUTE_SETTINGS) {
                SettingsScreen(
                    onBack = { nav.popBackStack() },
                    subjectPrefs = subjectPrefs,
                    onSavePrefs = { subject, color, emoji, label ->
                        prefsRepo.upsert(subject, color, emoji, label)
                        subjectPrefs = prefsRepo.prefs()
                    },
                    onRefreshPrefs = {
                        // Serveur non configuré : aucun appel (I1), prefs locales conservées.
                        if (baseUrl.isNotBlank()) {
                            prefsRepo.refresh(baseUrl) { subjectPrefs = it }
                        }
                    },
                    theme = theme,
                    onTheme = setTheme,
                )
            }
            composable("pairing") {
                if (baseUrl.isBlank()) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Appairage")
                        Text("Serveur non configuré.")
                        Button(onClick = { nav.popBackStack() }) { Text("Retour") }
                    }
                } else {
                    PairingRoute(baseUrl = baseUrl, onBack = { nav.popBackStack() })
                }
            }
            composable("alerts") { SecurityAlertsRoute(loadAlerts) }
            composable("fiches") { RevisionSheetsScreen() }
            // #78 : chips de compétences + détail, payload /v1/evaluations en cache.
            composable("competences") {
                CachedScreen(
                    title = "Compétences",
                    resource = CachePolicy.EVALUATIONS,
                    repo = repo,
                    baseUrl = baseUrl,
                    subtitle = "Évaluations par compétences",
                    goSettings = { nav.navigate(ROUTE_SETTINGS) },
                    goPairing = { nav.navigate("pairing") },
                    goAlerts = { nav.navigate("alerts") },
                    section = { CompetencesSection(it) },
                    subjectPrefs = subjectPrefs,
                )
            }
        }
    }
    }
}

@Composable
fun CachedScreen(
    title: String,
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    subtitle: String,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
    // #74 : mention "fournie"/"estimée" sous le titre (onglet Notes seul).
    showAverage: Boolean = false,
    // #83 : prefs matière du résolveur unique (légende couleur/emoji/libellé).
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // #78 : bloc competencies (chips) rendu sous le titre, payload en entrée.
    section: (@Composable (String?) -> Unit)? = null,
    // #78 : accès à l'écran compétences depuis l'onglet Notes.
    onCompetences: (() -> Unit)? = null,
) {
    // Etat initial = cache synchrone (affichage sans reseau immediat).
    var state by remember(resource) {
        val c = try {
            repo.cached(resource)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(if (c == null) UiState.Empty else uiStateFromCache(c, repo.isStale(resource, c)))
    }
    fun refresh() {
        // Serveur non configuré : pas d'appel (I1), état erreur avec cache si dispo.
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            return
        }
        state = when (val s = state) {
            // Re-affichage cache pendant reload (pas de spinner plein ecran si donnees).
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
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title)
        Text(subtitle)
        if (showAverage) {
            // Donnee contractuelle lue, jamais interpretee (I6). Absent = aucun affichage.
            val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
            Text(averageLabel(if (payload != null) generalAverageFrom(payload) else null))
        }
        when (val s = state) {
            UiState.Loading -> Text("Chargement…")
            UiState.Empty -> Text("Aucune donnée en cache. Connectez-vous puis actualisez.")
            is UiState.Data -> {
                if (s.isStale) Text("Données hors-ligne (périmé).")
                // #83 : matières du payload résolues (nom seul si aucune prefs).
                SubjectLegend(subjectsFromPayload(s.payload), subjectPrefs)

                section?.invoke(s.payload)
                // ponytail: payload brut affiche tel quel (donnee, jamais interpretee).
                Text(if (s.payload.length > 500) s.payload.take(500) + "…" else s.payload)
            }
            is UiState.Error -> {
                Text("Erreur réseau. Réessayer.")
                SubjectLegend(subjectsFromPayload(s.cached.orEmpty()), subjectPrefs)

                section?.invoke(s.cached)
                if (s.cached != null) Text(s.cached.take(500))
            }
        }
        Button(onClick = { refresh() }) { Text("Actualiser") }
        if (onCompetences != null) {
            Button(onClick = { onCompetences() }) { Text("Compétences") }
        }
        Button(onClick = { goSettings() }) { Text("Réglages") }
        Button(onClick = { goPairing() }) { Text("Appairage QR+PIN") }
        Button(onClick = { goAlerts() }) { Text("Alertes sécurité") }
    }
}

// Icônes d'onglets en texte (aucun asset copié, identité propre, LICENSE MIT).
// ponytail: glyphes seuls, pas d'Icon library avant besoin prouvé.
private fun tabIcon(route: String): String = when (route) {
    ROUTE_INDEX -> "⌂"
    ROUTE_CALENDAR -> "📅"
    ROUTE_GRADES -> "★"
    ROUTE_TASKS -> "✓"
    ROUTE_PROFILE -> "👤"
    else -> "•"
}

// Accueil #86 : widgets sur caches existants (affichage seul, jamais
// interprété). Vide propre si pas de cache (pas de spinner, pas de boucle).
// #82 brancherait ici /v1/me + périodes ; en attendant, zéro faux contenu.
@Composable
fun IndexScreen(
    repo: SyncedRepository,
    goCalendar: () -> Unit,
    goGrades: () -> Unit,
    goTasks: () -> Unit,
) {
    // ponytail: lecture synchrone des 3 caches (pas de ViewModel avant #82).
    val grades = try { repo.cached(CachePolicy.GRADES) } catch (_: Exception) { null }
    val assignments = try { repo.cached(CachePolicy.ASSIGNMENTS) } catch (_: Exception) { null }
    val timetable = try { repo.cached(CachePolicy.TIMETABLE) } catch (_: Exception) { null }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Accueil")
        if (grades == null && assignments == null && timetable == null) {
            Text("Aucune donnée en cache. Appairez puis actualisez un onglet.")
        } else {
            WidgetRow("Prochain cours", timetable, { repo.isStale(CachePolicy.TIMETABLE, it) }, goCalendar)
            WidgetRow("Devoirs", assignments, { repo.isStale(CachePolicy.ASSIGNMENTS, it) }, goTasks)
            WidgetRow("Dernières notes", grades, { repo.isStale(CachePolicy.GRADES, it) }, goGrades)
        }
    }
}

@Composable
private fun WidgetRow(
    title: String,
    entry: fr.veryslopnynotes.data.CachedEntry?,
    staleOf: (fr.veryslopnynotes.data.CachedEntry) -> Boolean,
    go: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title)
        if (entry == null) {
            Text("Pas de cache.")
        } else {
            if (staleOf(entry)) Text("Données hors-ligne (périmé).")
            // ponytail: extrait brut seul (jamais parsé/interprété côté app).
            Text(if (entry.payload.length > 200) entry.payload.take(200) + "…" else entry.payload)
        }
        Button(onClick = go) { Text("Ouvrir") }
    }
}

// Profil #86 : coquille parité (#82 profil/accueil, #77 vie scolaire
// brancheront /v1/me + présences ici). Affiche l'état réel local seul :
// serveur configuré ou non. Zéro faux user, zéro asset copié.
@Composable
fun ProfileScreen(
    baseUrl: String,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
    goFiches: () -> Unit,
    goNews: () -> Unit = {},
    goCanteen: () -> Unit = {},
    // #77 : vie scolaire (absences/retards + sanctions).
    goAttendance: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Profil")
        Text(if (baseUrl.isBlank()) "Serveur non configuré." else "Serveur configuré.")
        Text("Infos élève, périodes et vie scolaire arrivent avec la synchro (#82, #77).")
        Button(onClick = goPairing) { Text("Appairage QR+PIN") }
        Button(onClick = { goFiches() }) { Text("Fiches révision") }
        Button(onClick = { goNews() }) { Text("Actualités") }
        Button(onClick = { goCanteen() }) { Text("Cantine semaine") }
        Button(onClick = { goAttendance() }) { Text("Vie scolaire") }
        Button(onClick = goAlerts) { Text("Alertes sécurité") }
        Button(onClick = goSettings) { Text("Réglages") }
    }
}

// Réglages #83 : préférences matière (couleur/emoji/libellé, offline-first via
// SubjectPrefsRepository) + thème clair/sombre persisté (Theme.kt). Aucun effet
// réseau hors serveur allowlist, I1 intact.
// @OptIn: FilterChip.material3 tant qu'il reste annoté Expérimental.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // Signature = arguments édités, validation faite par isValid (contrat).
    onSavePrefs: (String, String?, String?, String?) -> Unit = { _, _, _, _ -> },
    onRefreshPrefs: () -> Unit = {},
    theme: AppTheme = AppTheme.SYSTEM,
    onTheme: (AppTheme) -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Réglages")
        Text("Thème : ${themeLabel(theme)}")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (mode in AppTheme.values().toList()) {
                FilterChip(
                    selected = theme == mode,
                    onClick = { onTheme(mode) },
                    label = { Text(themeLabel(mode)) },
                )
            }
        }
        Text("Matières")
        if (subjectPrefs.isEmpty()) {
            Text("Aucune matière personnalisée. Le nom d'origine est affiché partout.")
        } else {
            for (p in subjectPrefs) {
                SubjectPrefsEditor(
                    subject = p.subject,
                    color = p.color,
                    emoji = p.emoji,
                    label = p.label,
                    onSave = onSavePrefs,
                )
            }
        }
        // Matière inconnue = nom libre (validation isValid côté repository).
        var newSubject by remember { mutableStateOf("") }
        OutlinedTextField(
            value = newSubject,
            onValueChange = { newSubject = it },
            label = { Text("Matière à personnaliser") },
            singleLine = true,
        )
        Button(onClick = { onSavePrefs(newSubject, "", "", ""); newSubject = "" }) { Text("Ajouter la matière") }
        Button(onClick = { onRefreshPrefs() }) { Text("Synchroniser les préférences") }
        Button(onClick = onBack) { Text("Retour") }
    }
}

// ponytail: palette de 8 couleurs en dur (aucun Color Picker tant que le
// besoin n'est pas prouvé), champs texte = Material3 de base.
private val PREFS_PALETTE = listOf(
    "#E53935", "#D81B60", "#8E24AA", "#5E35B1",
    "#3949AB", "#1E88E5", "#43A047", "#FB8C00",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SubjectPrefsEditor(
    subject: String,
    color: String?,
    emoji: String?,
    label: String?,
    onSave: (String, String?, String?, String?) -> Unit,
) {
    var draftColor by remember(subject) { mutableStateOf(color ?: "") }
    var draftEmoji by remember(subject) { mutableStateOf(emoji ?: "") }
    var draftLabel by remember(subject) { mutableStateOf(label ?: "") }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(subject)
        OutlinedTextField(
            value = draftLabel,
            onValueChange = { draftLabel = it },
            label = { Text("Libellé") },
            singleLine = true,
        )
        OutlinedTextField(
            value = draftEmoji,
            onValueChange = { draftEmoji = it },
            label = { Text("Emoji") },
            singleLine = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (hex in PREFS_PALETTE) {
                FilterChip(
                    selected = draftColor.equals(hex, ignoreCase = true),
                    onClick = { draftColor = if (draftColor.equals(hex, ignoreCase = true)) "" else hex },
                    label = { Text("■", color = colorFromHex(hex) ?: MaterialTheme.colorScheme.onSurface) },
                )
            }
        }
        Button(onClick = { onSave(subject, draftColor, draftEmoji, draftLabel) }) { Text("Enregistrer $subject") }
    }
}

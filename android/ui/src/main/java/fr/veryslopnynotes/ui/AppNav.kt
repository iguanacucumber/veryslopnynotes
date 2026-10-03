package fr.veryslopnynotes.ui

import androidx.compose.foundation.Image
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.profileInitials
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.EncryptedTokenStore
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.FileSubjectPrefsStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.InMemorySubjectPrefsStore
import fr.veryslopnynotes.data.MeResult
import fr.veryslopnynotes.data.PhotoState
import fr.veryslopnynotes.data.ProfileRepository
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
    val cacheStore = remember(baseUrl) {
        try {
            FileCacheStore(java.io.File(ctx.filesDir, "offline"))
        } catch (_: Exception) {
            InMemoryCacheStore()
        }
    }
    val repo = remember(baseUrl, cacheStore) {
        SyncedRepository(ApiClient(baseUrl), cacheStore)
    }
    // #82 : comptes appairés + déconnexion (session invalidée + cache purgé).
    // Seuls des accountId sont persistés, aucune donnée personnelle.
    val accounts = remember(baseUrl, cacheStore) {
        AccountStore(ctx, cacheStore, EncryptedTokenStore(ctx))
    }
    val profileRepo = remember(baseUrl) { ProfileRepository(ApiClient(baseUrl)) }
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
                ProfileRoute(
                    baseUrl = baseUrl,
                    repo = profileRepo,
                    accounts = accounts,
                    onLogout = { accounts.logout() },
                    goSettings = { nav.navigate(ROUTE_SETTINGS) },
                    goPairing = { nav.navigate("pairing") },
                    goAlerts = { nav.navigate("alerts") },
                    goFiches = { nav.navigate("fiches") },
                    goNews = { nav.navigate(ROUTE_NEWS) },
                    goCanteen = { nav.navigate(ROUTE_CANTEEN) },
                )
            }
            composable(ROUTE_NEWS) {
                NewsRoute(repo, baseUrl)
            }
            composable(ROUTE_CANTEEN) {
                CanteenRoute(repo, baseUrl)
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

// Accueil #82 : widgets sur caches existants, données STRUCTURÉES du contrat
// (helpers testables dans HomeWidgets.kt). Aucune requête ajoutée : l'accueil
// reste offline-first (cache d'abord), et un cache absent = état vide propre.
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
        Text("Accueil")
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
                Text("Prochain cours")
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
                Text("Devoirs")
                for (h in homework) {
                    Text("${homeTimeLabel(h.dueDate)} · ${h.subject} — ${h.title}")
                }
            }
            Button(onClick = goTasks) { Text("Ouvrir les tâches") }

            val latest = grades?.payload?.let { latestGradesFrom(it) } ?: emptyList()
            if (latest.isEmpty()) {
                Text("Dernières notes : aucune note en cache.")
            } else {
                Text("Dernières notes")
                for (g in latest) {
                    Text("${g.subject} : ${g.note}")
                }
            }
            Button(onClick = goGrades) { Text("Ouvrir les notes") }
        }
    }
}

// Profil #82 (parité Papillon) : écran alimenté par /v1/me. Nom, classe,
// période courante, photo via le PROXY serveur (réF opaque, jamais une adresse
// Pronote/ENT — I1), enfants d'un compte parent, déconnexion (session invalidée
// + cache purgé). Aucune donnée personnelle persistée : hors-ligne = mode
// anonyme, état vide propre. Zéro faux user, zéro asset copié.
// ponytail: état local (comme les autres onglets), pas de ViewModel. Upgrade:
//   sélecteur de compte quand plusieurs enfants sont appairés.
@Composable
fun ProfileScreen(
    baseUrl: String,
    profile: UserProfile?,
    photo: PhotoState,
    accountCount: Int,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
    goFiches: () -> Unit,
    goNews: () -> Unit = {},
    goCanteen: () -> Unit = {},
    onLogout: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Profil")
        if (baseUrl.isBlank()) {
            Text("Serveur non configuré.")
        } else if (profile == null) {
            // Compte appairé sans infos publiées : état vide, pas de nom d'exemple.
            Text("Aucune information publiée pour ce compte.")
        } else {
            when (photo) {
                is PhotoState.Loaded ->
                    Image(
                        bitmap = photo.bitmap.asImageBitmap(),
                        contentDescription = "Photo du profil",
                        modifier = Modifier.padding(4.dp),
                    )
                // Réf absente, média KO ou non configuré = initiales de repli.
                else -> Text(profileInitials(profile))
            }
            Text(profile.displayName)
            if (profile.classLabel.isNotEmpty()) Text("Classe : ${profile.classLabel}")
            // Période courante publiée par /v1/me ; la liste des périodes de l'année
            // reste sur /v1/periods (contrat #74).
            if (profile.periodName.isNotEmpty()) Text("Période : ${profile.periodName}")
            if (profile.hasKids) {
                Text("Comptes enfants")
                for (k in profile.kids) {
                    val klass = if (k.classLabel.isEmpty()) "" else " (${k.classLabel})"
                    Text("${k.displayName}$klass")
                }
            }
        }
        Text(if (accountCount > 1) "Comptes appairés : $accountCount" else "1 compte appairé")
        Button(onClick = goPairing) { Text("Appairage QR+PIN") }
        Button(onClick = { goFiches() }) { Text("Fiches révision") }
        Button(onClick = { goNews() }) { Text("Actualités") }
        Button(onClick = { goCanteen() }) { Text("Cantine semaine") }
        Button(onClick = goAlerts) { Text("Alertes sécurité") }
        Button(onClick = goSettings) { Text("Réglages") }
        Button(onClick = onLogout) { Text("Se déconnecter") }
    }
}

// Écran Profil câblé : lecture /v1/me (mémoire seule) + photo via proxy.
// Déconnexion = session appairée invalidée, caches purgés, profil abandonné.
@Composable
fun ProfileRoute(
    baseUrl: String,
    repo: ProfileRepository,
    accounts: AccountStore,
    onLogout: () -> Unit,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
    goFiches: () -> Unit,
    goNews: () -> Unit = {},
    goCanteen: () -> Unit = {},
) {
    var profile by remember(baseUrl) { mutableStateOf<UserProfile?>(null) }
    var loaded by remember(baseUrl) { mutableStateOf(false) }
    var error by remember(baseUrl) { mutableStateOf("") }
    var photo by remember(baseUrl) { mutableStateOf<PhotoState>(PhotoState.Absent) }
    var accountCount by remember(baseUrl) { mutableStateOf(accounts.count()) }
    fun refresh() {
        // Serveur non configuré : aucun appel (I1).
        if (baseUrl.isBlank()) {
            loaded = true
            return
        }
        try {
            repo.fetchMe { r ->
                loaded = true
                error = ""
                accountCount = accounts.count()
                when (r) {
                    is MeResult.Err -> error = r.message
                    is MeResult.Ok -> {
                        profile = r.profile
                        val p = r.profile
                        if (p == null) {
                            photo = PhotoState.Absent
                        } else {
                            repo.fetchPhoto(p) { bitmap ->
                                photo = if (bitmap == null) PhotoState.Absent else PhotoState.Loaded(bitmap)
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {
            loaded = true
            error = "Profil indisponible."
        }
    }
    Button(onClick = { refresh() }) { Text(if (loaded) "Actualiser le profil" else "Charger le profil") }
    if (error.isNotEmpty()) Text(error)
    ProfileScreen(
        baseUrl = baseUrl,
        profile = profile,
        photo = photo,
        accountCount = accountCount,
        goSettings = goSettings,
        goPairing = goPairing,
        goAlerts = goAlerts,
        goFiches = goFiches,
        goNews = goNews,
        goCanteen = goCanteen,
        onLogout = {
            onLogout()
            profile = null
            photo = PhotoState.Absent
            loaded = false
            error = ""
            accountCount = accounts.count()
        },
    )
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

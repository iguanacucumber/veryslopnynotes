package fr.veryslopnynotes.ui

import android.os.Handler
import android.os.Looper
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDeepLink
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navDeepLink
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.core.ServerUrlResult
import fr.veryslopnynotes.core.UserProfile
import fr.veryslopnynotes.core.profileInitials
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.FileSubjectPrefsStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.InMemorySubjectPrefsStore
import fr.veryslopnynotes.data.LlmKeys
import fr.veryslopnynotes.data.MeResult
import fr.veryslopnynotes.data.PhotoState
import fr.veryslopnynotes.data.ProfileRepository
import fr.veryslopnynotes.data.ServerStore
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SubjectPrefsRepository
import fr.veryslopnynotes.data.SyncedRepository
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SessionTokens

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
// EDT #76 : route "calendar" = TimetableRoute (vue semaine, prochain cours +
// salle, statuts annulé/déplacé, hors-ligne par le cache `timetable`).
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
// #80 : messagerie (parité Papillon Discussions), hors onglets comme les autres
// capacités dynamiques : visible seulement si l'établissement publie des fils.
const val ROUTE_MESSAGES = "messages"
// #113 : écran d'appairage = destination de secours quand le serveur refuse la
// credential d'appareil (401). Une seule constante pour tous les `navigate`.
const val ROUTE_PAIRING = "pairing"

private val TAB_ROUTES = listOf(ROUTE_INDEX, ROUTE_CALENDAR, ROUTE_GRADES, ROUTE_TASKS, ROUTE_PROFILE)

/**
 * #133 : chaque route est atteignable par `veryslopnynotes://<route>`, ce qui
 * permet de capturer un écran SANS taper au doigt aux coordonnées (elles changent
 * avec la taille d'écran, la barre système et le thème).
 *
 * Le `<intent-filter>` qui rend ces URL ouvrables vit UNIQUEMENT dans le source
 * set debug (android/app/src/debug/AndroidManifest.xml) : en release l'app ne
 * répond à aucune URL extérieure. Sans l'intention-filter, une URL qui n'est
 * déclarée nulle part est une NOUVELLE tâche, jamais la tâche courante.
 *
 * ponytail: `navDeepLink` existe déjà dans navigation-compose, aucun fil
 * d'attente à écrire. Le RELEASE reste sans deep link ; upgrade : une intention
 * interne explicite (`am broadcast`) si l'on veut un jour ouvrir un onglet
 * depuis le serveur — jamais un scheme public.
 */
private fun routeDeepLink(route: String): NavDeepLink =
    navDeepLink { uriPattern = "veryslopnynotes://$route" }

private fun tabLabel(route: String): String = when (route) {
    ROUTE_INDEX -> "Accueil"
    ROUTE_CALENDAR -> "Calendrier"
    ROUTE_GRADES -> "Notes"
    ROUTE_TASKS -> "Tâches"
    ROUTE_PROFILE -> "Profil"
    else -> route
}

/**
 * Changement de serveur = changement d'établissement. Le jeton d'appareil est
 * un BEARER de l'ANCIEN serveur : le conserver enverrait un credential vivant
 * au nouveau. Donc, dans cet ordre : valider (aucun effet de bord), purger
 * session + caches par le chemin EXISTANT `accounts.logout()` (ni purge
 * parallèle, ni nouveau store), puis persister. Un refus renvoie son message
 * français et ne change RIEN ; `onSwitched` n'est appelé qu'une fois la purge
 * faite et l'adresse enregistrée.
 *
 * ponytail: purge AVANT écriture — un stockage KO coûte alors une déconnexion,
 * alors que l'inverse laisserait une fenêtre où le nouveau serveur est écrit et
 * le credential de l'ancien encore vivant. Fonction top-level (pas une locale
 * dans le composable) : la validation et l'ordre des effets n'ont rien à faire
 * dans un corps recomposé. `when` + `is` positif : dans ce module, le plugin
 * Compose casse le smart cast après un `!is` (vérifié à la compilation).
 */
private fun changeServer(
    raw: String,
    current: String,
    accounts: AccountStore,
    serverStore: ServerStore,
    onSwitched: (String) -> Unit,
): String? {
    val target = when (val validated = ServerConfig.validateBaseUrl(raw)) {
        is ServerUrlResult.Rejected -> return validated.message
        is ServerUrlResult.Ok -> validated.baseUrl
    }
    if (target == current) return null
    // On enregistre AVANT de déconnecter : si l'écriture échoue, l'utilisateur
    // garde sa session et son cache au lieu d'être déconnecté pour rien.
    val saved = serverStore.save(target)
    if (saved is ServerUrlResult.Rejected) return saved.message
    accounts.logout()
    onSwitched(target)
    return null
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppNav(
    // Graine par défaut (valeur BuildConfig) : l'adresse UTILISÉE est l'état
    // ci-dessous, alimenté par ServerStore — l'utilisateur choisit son
    // serveur dans l'écran d'appairage. "" = non configuré (bouchon
    // previews/tests sans BuildConfig).
    baseUrlSeed: String = "",
    // #75 : compte appairé, sert au toggle (écriture confirmée par l'app, I7)
    // et au proxy des pièces jointes. Jamais un hôte Pronote (I1).
    accountId: String = "",
    // L'adresse est passée à l'appel : le repository doit suivre le serveur
    // courant, pas celui du lancement de l'activité.
    loadAlerts: suspend (String) -> List<SecurityAlert> = { emptyList() },
) {
    val nav = rememberNavController()
    val ctx = LocalContext.current.applicationContext
    // Serveur choisi à l'exécution : `baseUrl` devient un ÉTAT. Toutes les
    // `remember(baseUrl)` plus bas rebloquent donc leurs repositories sur la
    // nouvelle adresse, et les routes lisent le même état.
    val serverStore = remember(ctx) { ServerStore(ctx) }
    // 0.7.0 : clé LLM = UN store pour tout le process (réglages + écran devoirs),
    // sinon les deux écrans raisonneraient sur deux états divergents. L'état
    // d'affichage est relu après chaque écriture : le store est la vérité.
    val llmKeys = remember(ctx) { LlmKeys.get(ctx) }
    var llmKeyConfigured by remember(llmKeys) { mutableStateOf(llmKeys.isConfigured()) }
    var baseUrl by remember(serverStore) { mutableStateOf(serverStore.baseUrl(baseUrlSeed)) }
    // ponytail: fichier natif seul (pas de Room). Repli memoire si stockage KO.
    val cacheStore = remember(baseUrl) {
        try {
            FileCacheStore(java.io.File(ctx.filesDir, "offline"))
        } catch (_: Exception) {
            InMemoryCacheStore()
        }
    }
    // Session appairée UNIQUE partagée : un seul store, lu par ApiClient à
    // chaque requête (bearer) et vidé par accounts.logout(). Deux stores
    // divergents (chiffré côté écrans, mémoire ailleurs) laisseraient le secret
    // vivant après une déconnexion.
    val tokens = remember(ctx) { SessionTokens.get(ctx) }
    val repo = remember(baseUrl, cacheStore, tokens) {
        SyncedRepository(ApiClient(baseUrl, tokens = tokens), cacheStore)
    }
    // #82 : comptes appairés + déconnexion (session invalidée + cache purgé).
    // Seuls des accountId sont persistés, aucune donnée personnelle.
    val accounts = remember(baseUrl, cacheStore, tokens) {
        AccountStore(ctx, cacheStore, tokens)
    }
    // #113 : un 401 (credential révoquée/expirée — INDISTINGUABLES côté serveur)
    // ne doit plus se traduire par des échecs silencieux. Le signal unique vient
    // du garde-fou ApiClient (une 401 sur route protégée qui portait un bearer) ;
    // ici on répare par le chemin EXISTANT `accounts.logout()` (secret effacé +
    // caches purgés, aucune purge parallèle) puis on ramène à l'appairage.
    // Anti-boucle : après logout() plus aucun bearer ne part, donc le garde-fou
    // ne peut plus se déclencher, et on ne navigue pas deux fois.
    var authNotice by remember { mutableStateOf<String?>(null) }
    val main = remember { Handler(Looper.getMainLooper()) }
    DisposableEffect(accounts) {
        DeviceAuth.setOnRejected {
            main.post {
                authNotice = DeviceAuth.REJECTED_MESSAGE
                accounts.logout()
                if (nav.currentDestination?.route != ROUTE_PAIRING) {
                    nav.navigate(ROUTE_PAIRING) {
                        popUpTo(nav.graph.findStartDestination().id) { inclusive = true }
                    }
                }
            }
        }
        onDispose { DeviceAuth.setOnRejected(null) }
    }
    val profileRepo = remember(baseUrl, tokens) { ProfileRepository(ApiClient(baseUrl, tokens = tokens)) }
    // #83 : prefs matière = fichier local (survit au restart, lisible hors
    // ligne), répliqué vers le serveur allowlist seul (I1).
    val prefsRepo = remember(baseUrl, tokens) {
        val store = try {
            FileSubjectPrefsStore(java.io.File(ctx.filesDir, "offline/subject_prefs.json"))
        } catch (_: Exception) {
            InMemorySubjectPrefsStore()
        }
        SubjectPrefsRepository(ApiClient(baseUrl, tokens = tokens), store)
    }
    var subjectPrefs by remember { mutableStateOf(prefsRepo.prefs()) }
    // #87 : capacites dynamiques (onglets Pronote actifs de l'etablissement).
    // Etat initial = cache local (offline-first, comme les autres ressources) ;
    // null = capacites inconnues => AUCUN masquage (see Capabilities.visible).
    var capabilities by remember(baseUrl) {
        mutableStateOf(
            try {
                Capabilities.parse(repo.cached(CachePolicy.CAPABILITIES)?.payload)
            } catch (_: Exception) {
                null
            },
        )
    }
    /**
     * Detecte les onglets actifs : lecture de /v1/capabilities (ressource
     * cachee, offline-first) puis relecture forcee POST /v1/sync/refresh
     * (lecture seule cote serveur, aucun effet metier : I7) suivie d'une
     * nouvelle lecture de la liste. Un echec reseau laisse l'etat courant :
     * jamais d'onglet masque sur une panne.
     */
    fun detectCapabilities() {
        if (baseUrl.isBlank()) return
        // #87 : null = rien à appliquer, l'état précédent est conservé.
        fun reload() {
            try {
                repo.refreshAsync(CachePolicy.CAPABILITIES, baseUrl) { o ->
                    Capabilities.parse(capabilitiesPayload(o))?.let { capabilities = it }
                }
            } catch (_: Exception) {
            }
        }
        reload()
        try {
            repo.requestSyncRefresh(baseUrl, accountId) { _ -> reload() }
        } catch (_: Exception) {
        }
    }
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
            // #120 : premier lancement OU session morte = l'assistant de
            // connexion, pas un Accueil qui ne peut rien afficher. Le secret
            // est relu au COMPOSABLE parent (une seule source : c'est lui que
            // l'API et l'écran d'appairage partagent).
            startDestination = if (tokens.isPaired()) ROUTE_INDEX else ROUTE_PAIRING,
            modifier = Modifier.padding(pad),
        ) {
            composable(ROUTE_INDEX, deepLinks = listOf(routeDeepLink(ROUTE_INDEX))) {
                IndexScreen(repo, { nav.navigate(ROUTE_CALENDAR) }, { nav.navigate(ROUTE_GRADES) }, { nav.navigate(ROUTE_TASKS) })
            }
            composable(ROUTE_CALENDAR, deepLinks = listOf(routeDeepLink(ROUTE_CALENDAR))) {
                // #76 : vue semaine EDT (prof, statut annulé/déplacé, salle du
                // prochain cours, navigation de semaine, hors-ligne via cache).
                TimetableRoute(
                    repo = repo,
                    baseUrl = baseUrl,
                    subjectPrefs = subjectPrefs,
                    onSettings = { nav.navigate(ROUTE_SETTINGS) },
                    onPairing = { nav.navigate(ROUTE_PAIRING) },
                    onAlerts = { nav.navigate("alerts") },
                )
            }
            composable(ROUTE_GRADES, deepLinks = listOf(routeDeepLink(ROUTE_GRADES))) {
                // #87 : accès à l'écran compétences seulement si l'onglet est actif.
                val gotoCompetences: (() -> Unit)? = if (Capabilities.visible(capabilities, Capabilities.EVALUATIONS)) {
                    { nav.navigate("competences") }
                } else {
                    null
                }
                CachedScreen(
                    "Notes",
                    CachePolicy.GRADES,
                    repo,
                    baseUrl,
                    "Moyennes",
                    { nav.navigate(ROUTE_SETTINGS) },
                    { nav.navigate(ROUTE_PAIRING) },
                    { nav.navigate("alerts") },
                    showAverage = true,
                    subjectPrefs = subjectPrefs,
                    onCompetences = gotoCompetences,
                )
            }
            composable(ROUTE_TASKS, deepLinks = listOf(routeDeepLink(ROUTE_TASKS))) {
                // #75 : devoirs de la semaine (contenus + PJ via proxy), toggle
                // Optimiste avec retour arrière, pull-refresh.
                AssignmentsRoute(
                    CachePolicy.ASSIGNMENTS,
                    repo,
                    baseUrl,
                    accountId,
                    subjectPrefs = subjectPrefs,
                    tokens = tokens,
                    llmKeys = llmKeys,
                )
            }
            composable(ROUTE_PROFILE, deepLinks = listOf(routeDeepLink(ROUTE_PROFILE))) {
                ProfileRoute(
                    baseUrl = baseUrl,
                    repo = profileRepo,
                    accounts = accounts,
                    onLogout = { accounts.logout() },
                    goSettings = { nav.navigate(ROUTE_SETTINGS) },
                    goPairing = { nav.navigate(ROUTE_PAIRING) },
                    goAlerts = { nav.navigate("alerts") },
                    goFiches = { nav.navigate("fiches") },
                    goNews = { nav.navigate(ROUTE_NEWS) },
                    goCanteen = { nav.navigate(ROUTE_CANTEEN) },
                    goAttendance = { nav.navigate(ROUTE_ATTENDANCE) },
                    // #87 : entrees masquees selon les onglets actifs.
                    capabilities = capabilities,
                    onRefreshCapabilities = { detectCapabilities() },

                    goMessages = { nav.navigate(ROUTE_MESSAGES) },
                )
            }
            composable(ROUTE_NEWS, deepLinks = listOf(routeDeepLink(ROUTE_NEWS))) {
                NewsRoute(repo, baseUrl)
            }
            composable(ROUTE_CANTEEN, deepLinks = listOf(routeDeepLink(ROUTE_CANTEEN))) {
                CanteenRoute(repo, baseUrl)
            }
            // #77 : vie scolaire — absences/retards + compteurs par période,
            // puis sanctions (même ressource, écran secondaire).
            composable(ROUTE_ATTENDANCE, deepLinks = listOf(routeDeepLink(ROUTE_ATTENDANCE))) {
                AttendanceRoute(repo, baseUrl, onSanctions = { nav.navigate("sanctions") })
            }
            composable("sanctions", deepLinks = listOf(routeDeepLink("sanctions"))) {
                PunishmentsRoute(repo, baseUrl, onBack = { nav.popBackStack() })
            }
            composable(ROUTE_SETTINGS, deepLinks = listOf(routeDeepLink(ROUTE_SETTINGS))) {
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
                    llmKeyConfigured = llmKeyConfigured,
                    onSaveLlmKey = { key ->
                        // `save` lève si la clé est vide/hors borne : le champ est
                        // déjà désactivé dans ce cas, on ignore l'échec silencieux.
                        try {
                            llmKeys.save(key)
                            llmKeyConfigured = llmKeys.isConfigured()
                        } catch (_: IllegalArgumentException) {
                            llmKeyConfigured = llmKeys.isConfigured()
                        }
                    },
                    onForgetLlmKey = {
                        llmKeys.clear()
                        llmKeyConfigured = false
                    },
                )
            }
            composable(ROUTE_PAIRING, deepLinks = listOf(routeDeepLink(ROUTE_PAIRING))) {
                // Serveur vide = aucune graine de build : on montre QUAND MÊME
                // le champ (c'est là que l'utilisateur saisit son adresse), pas
                // un cul-de-sac — sans serveur, on ne peut pas appairer.
                // #113 : `notice` = raison factuelle de l'arrivée ici (credential
                // refusée). Pas de cause devinée, pas de bouton « réessayer » :
                // le seul geste utile est l'appairage.
                PairingRoute(
                    baseUrl = baseUrl,
                    onBack = { nav.popBackStack() },
                    notice = authNotice,
                    // null = enregistrée (session purgée), sinon message à afficher.
                    onServerChange = { raw ->
                        changeServer(raw, baseUrl, accounts, serverStore) { url ->
                            authNotice = null
                            baseUrl = url
                        }
                    },
                    // Setup réussi = la session ET le credential sont en place :
                    // on va droit à l'accueil. Aucun écran de confirmation à
                    // faire valider, l'utilisateur n'a plus rien à prouver.
                    onPaired = {
                        if (!nav.popBackStack(ROUTE_INDEX, inclusive = false)) {
                            nav.navigate(ROUTE_INDEX)
                        }
                    },
                )
            }
            composable("alerts", deepLinks = listOf(routeDeepLink("alerts"))) { SecurityAlertsRoute { loadAlerts(baseUrl) } }
            composable("fiches", deepLinks = listOf(routeDeepLink("fiches"))) { RevisionSheetsScreen() }
            // #78 : chips de compétences + détail, payload /v1/evaluations en cache.
            composable("competences", deepLinks = listOf(routeDeepLink("competences"))) {
                CachedScreen(
                    title = "Compétences",
                    resource = CachePolicy.EVALUATIONS,
                    repo = repo,
                    baseUrl = baseUrl,
                    subtitle = "Évaluations par compétences",
                    goSettings = { nav.navigate(ROUTE_SETTINGS) },
                    goPairing = { nav.navigate(ROUTE_PAIRING) },
                    goAlerts = { nav.navigate("alerts") },
                    section = { CompetencesSection(it) },
                    subjectPrefs = subjectPrefs,
                )
            }
            // #80 : messagerie — liste des fils (cache), lecture d'un fil, réponse,
            // création, lu/non-lu et suppression (boutons = actions confirmées, I7).
            composable(ROUTE_MESSAGES, deepLinks = listOf(routeDeepLink(ROUTE_MESSAGES))) {
                MessagesRoute(repo, baseUrl, accountId, tokens = tokens)
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

// #87 : payload disponible après un refresh (#87) — réseau OK, repli cache, ou
// cache du Failed. null = rien à appliquer (l'état précédent est conservé).
private fun capabilitiesPayload(o: RefreshOutcome): String? = when (o) {
    is RefreshOutcome.Updated -> o.payload
    is RefreshOutcome.OfflineFallback -> o.payload
    is RefreshOutcome.Failed -> o.cachedPayload
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
// Pronote — I1), enfants d'un compte parent, déconnexion (session invalidée
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
    // #77 : vie scolaire (absences/retards + sanctions).
    goAttendance: () -> Unit = {},
    // #87 : capacites connues (null = rien n'est masque) + lecture des onglets.
    capabilities: Capabilities? = null,
    onRefreshCapabilities: () -> Unit = {},

    // #80 : messagerie (discussions).
    goMessages: () -> Unit = {},
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
        // #87 : une entree dont l'onglet n'est pas actif chez l'etablissement
        // n'est pas proposee ; son ecran reste atteignable en cas de besoin et
        // affiche son etat vide propre.
        if (Capabilities.visible(capabilities, Capabilities.NEWS)) {
            Button(onClick = { goNews() }) { Text("Actualités") }
        }
        if (Capabilities.visible(capabilities, Capabilities.MENUS)) {
            Button(onClick = { goCanteen() }) { Text("Cantine semaine") }
        }
        if (Capabilities.visible(capabilities, Capabilities.ATTENDANCE)) {
            Button(onClick = { goAttendance() }) { Text("Vie scolaire") }
        }
        Button(onClick = { onRefreshCapabilities() }) { Text("Détecter les onglets") }
        Button(onClick = { goNews() }) { Text("Actualités") }
        Button(onClick = { goCanteen() }) { Text("Cantine semaine") }
        Button(onClick = { goAttendance() }) { Text("Vie scolaire") }

        Button(onClick = { goNews() }) { Text("Actualités") }
        Button(onClick = { goCanteen() }) { Text("Cantine semaine") }
        Button(onClick = { goAttendance() }) { Text("Vie scolaire") }
        Button(onClick = { goMessages() }) { Text("Messages") }
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
    // #77 : vie scolaire (absences/retards + sanctions).
    goAttendance: () -> Unit = {},
    // #87 : capacites dynamiques + lecture des onglets actifs.
    capabilities: Capabilities? = null,
    onRefreshCapabilities: () -> Unit = {},

    // #80 : messagerie (discussions).
    goMessages: () -> Unit = {},
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
        goAttendance = goAttendance,
        capabilities = capabilities,
        onRefreshCapabilities = onRefreshCapabilities,

        goMessages = goMessages,
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
    // 0.7.0 : clé du fournisseur LLM. Le serveur n'en détient aucune, donc
    // elle se saisit ICI, chiffrée (LlmKeyStore). Jamais pré-remplie dans le
    // champ : on affiche seulement si une clé existe, la saisie est en clair
    // dans le champ de l'app (l'utilisateur veut la relire/corriger).
    llmKeyConfigured: Boolean = false,
    onSaveLlmKey: (String) -> Unit = {},
    onForgetLlmKey: () -> Unit = {},
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
        // Clé LLM : credential de l'utilisateur, pas une session d'appareil.
        // "Oublier" EFFACE la valeur du store (elle n'est pas renvoyée par le
        // serveur, personne ne peut la reconstruire à sa place).
        Text("Assistant devoirs")
        Text(
            if (llmKeyConfigured) {
                "Clé enregistrée (chiffrée). Elle part avec chaque demande, jamais stockée par le serveur."
            } else {
                "Aucune clé : l'assistant reste inactif tant qu'elle n'est pas saisie."
            },
        )
        var llmKey by remember { mutableStateOf("") }
        OutlinedTextField(
            value = llmKey,
            onValueChange = { llmKey = it },
            label = { Text("Clé du fournisseur LLM") },
            singleLine = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onSaveLlmKey(llmKey); llmKey = "" },
                enabled = llmKey.isNotBlank(),
            ) { Text("Enregistrer la clé") }
            TextButton(onClick = { onForgetLlmKey() }, enabled = llmKeyConfigured) { Text("Oublier") }
        }
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

package fr.veryslopnynotes.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDeepLink
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navDeepLink
import fr.veryslopnynotes.core.Capabilities
import fr.veryslopnynotes.data.AccountStore
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.FileSubjectPrefsStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.InMemorySubjectPrefsStore
import fr.veryslopnynotes.data.LlmKeys
import fr.veryslopnynotes.data.ProfileRepository
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.ServerStore
import fr.veryslopnynotes.data.SessionStores
import fr.veryslopnynotes.data.SubjectPrefsRepository
import fr.veryslopnynotes.data.SyncedRepository

// Graphe de navigation et état de la session. La COQUILLE (barre du haut par
// route, barre d'onglets, icônes) vit dans `AppShell.kt` et `AppIcons.kt`, les
// ÉCRANS chacun dans son fichier : avant #135 ce fichier faisait 989 lignes et
// portait la coquille ET quatre écrans.
// #135 : chaque `navigate` passe par `navigateTo`/`openTab` (`launchSingleTop`).
//
// Parité Papillon #86 : 5 onglets + settings, et des routes secondaires hors
// onglets (pairing, alerts, fiches, news, canteen, attendance, messages,
// sanctions), masquées ou non selon les capacités publiées par l'établissement
// (#87). Lecture en cache d'abord (offline-first #14, jamais de spinner si le
// cache est là). Contenu serveur affiché comme donnée, jamais
// interprété.

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
// #113 : écran d'appairage = destination de secours quand la session locale
// meurt (jeton tourné, session refermée). Une seule constante pour tous les `navigate`.
const val ROUTE_PAIRING = "pairing"
// #135 : ces quatre routes se naviguaient en LITTERAL NU pendant que onze autres
// avaient une constante — une faute de frappe ne se voyait qu'à la compilation.
const val ROUTE_ALERTS = "alerts"
const val ROUTE_FICHES = "fiches"
const val ROUTE_SANCTIONS = "sanctions"

/** Navigation vers une route, SANS doublon : `launchSingleTop = true`. #135 : avant,
 *  les huit `nav.navigate(...)` de la coquille étaient nus — revenir après
 *  « Ouvrir l'EDT » empilait un DEUXIÈME écran au lieu de sortir. */
private fun NavHostController.navigateTo(route: String) {
    navigate(route) { launchSingleTop = true }
}

/** Onglet : une seule instance par onglet — `popUpTo` + `saveState` vident la
 *  pile au-dessus de l'accueil, `restoreState` la restitue à l'identique. */
private fun NavHostController.openTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/**
 * #133 : chaque route est atteignable par `veryslopnynotes://<route>`, ce qui
 * permet de capturer un écran SANS taper au doigt aux coordonnées (elles changent
 * avec la taille d'écran, la barre système et le thème).
 *
 * Le `<intent-filter>` qui rend ces URL ouvrables vit UNIQUEMENT dans le source
 * set debug (android/app/src/debug/AndroidManifest.xml) : en release l'app ne
 * répond à aucune URL extérieure. Sans l'intention-filter, une URL qui n'est
 * pas déclarée nulle part est une NOUVELLE tâche, jamais la tâche courante.
 *
 * ponytail: `navDeepLink` existe déjà dans navigation-compose, aucun fil
 * d'attente à écrire ; upgrade : une intention interne explicite (`am broadcast`)
 * pour ouvrir un onglet depuis le serveur — jamais un scheme public.
 */
private fun routeDeepLink(route: String): NavDeepLink =
    navDeepLink { uriPattern = "veryslopnynotes://$route" }

// #87 : payload d'un refresh — réseau OK, repli cache, ou cache du Failed.
// null = rien à appliquer (l'état précédent est conservé).
private fun capabilitiesPayload(o: RefreshOutcome): String? = when (o) {
    is RefreshOutcome.Updated -> o.payload
    is RefreshOutcome.OfflineFallback -> o.payload
    is RefreshOutcome.Failed -> o.cachedPayload
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppNav(
    // Graine par défaut (valeur BuildConfig) : l'adresse UTILISÉE est l'état
    // ci-dessous, alimenté par ServerStore. "" = non configuré (bouchon
    // previews/tests sans BuildConfig).
    baseUrlSeed: String = "",
    // #75 : compte courant (jamais un hôte) : transmis aux routes qui
    // l'affichent, et l'écriture reste une action utilisateur confirmée (I7).
    accountId: String = "",
    // #172 : `loadAlerts` retiré — mort depuis #144 (l'écran Alertes lit le cache).
    // #303 : hauteur reprise à la barre de statut (MÊME MASQUÉE) — mesurée par
    // l'activité, car `ui` ne lit aucun inset de fenêtre. 0 dp = barres visibles.
    reclaimedTop: Dp = 0.dp,
) {
    val nav = rememberNavController()
    val ctx = LocalContext.current.applicationContext
    // Adresse du scraper (graine de build + choix persisté, revalidé par
    // `ServerConfig`, #209) : lue UNE fois ici, partagée en lecture seule par
    // les routes. Les dépôts locaux l'ignorent (le téléphone parle à
    // l'établissement en direct) ; elle resservira au corpus via le scraper.
    val serverStore = remember(ctx) { ServerStore(ctx) }
    val baseUrl = remember(serverStore) { serverStore.baseUrl(baseUrlSeed) }
    // ponytail: fichier natif seul (pas de Room). Repli memoire si stockage KO.
    val cacheStore = remember(baseUrl) {
        try {
            FileCacheStore(java.io.File(ctx.filesDir, "offline"))
        } catch (_: Exception) {
            InMemoryCacheStore()
        }
    }
    // Session Pronote UNIQUE partagée : le store chiffré (lu au démarrage par
    // restauration, vidé par accounts.logout()) + le client en mémoire. Deux
    // stores divergents laisseraient le jeton vivant après une déconnexion.
    val sessions = remember(ctx) { SessionStores.get(ctx) }
    // #205 : dépôts locaux (client du téléphone + cache, ADR-003).
    val repo = remember(cacheStore) { SyncedRepository(cacheStore) }
    // #82 : comptes appairés + déconnexion (session invalidée + cache purgé).
    // Seuls des accountId sont persistés, aucune donnée personnelle.
    val accounts = remember(cacheStore, sessions) {
        AccountStore(ctx, cacheStore, sessions)
    }
    // #113 : une session morte (jeton tourné, session refermée — le client ne
    // distingue pas) ne doit plus se traduire par des échecs silencieux. La
    // réparation vit dans `SessionGate` (signal des dépôts locaux +
    // restauration au démarrage) ; ici ne reste que la phrase factuelle qui
    // survit à la rotation (#147 : sans elle, un écran de connexion ressemble
    // à une panne).
    var authNotice by rememberSaveable { mutableStateOf<String?>(null) }
    SessionGate(sessions = sessions, accounts = accounts, nav = nav, onNotice = { authNotice = it })
    val profileRepo = remember { ProfileRepository() }
    // #83 : prefs matière = fichier local (survit au restart, lisible hors
    // ligne). #205 : plus de réplication serveur, le fichier EST la vérité.
    val prefsRepo = remember {
        val store = try {
            FileSubjectPrefsStore(java.io.File(ctx.filesDir, "offline/subject_prefs.json"))
        } catch (_: Exception) {
            InMemorySubjectPrefsStore()
        }
        SubjectPrefsRepository(store)
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
     * Detecte les onglets actifs : lecture des capacités (ressource
     * cachee, offline-first) puis ping de session local (aucun effet
     * metier : I7), suivie d'une nouvelle lecture de la liste. Un
     * echec laisse l'etat courant.
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
    // #162 : la barre du haut porte les destinations ET la relecture (compteur que
    // regardent les deux routes qui l'ont). #87 : une destination masquée si
    // l'onglet n'est pas actif. #172 : `punishments` s'y range maintenant aussi,
    // « Sanctions » étant devenu une action de la barre de la Vie scolaire.
    var readTick by remember { mutableStateOf(0) }
    // #190 : case d'en-tête partagée entre l'écran qui publie (Notes) et la
    // barre qui lit. UN objet pour toute l'app, mémorisé : `remember` sans clé
    // survit aux changements de route, donc la case n'est pas vidée à chaque
    // navigation.
    val headerSlot = remember { PapHeaderSlot() }
    val hiddenDestinations = buildSet {
        if (!Capabilities.visible(capabilities, Capabilities.PUNISHMENTS)) add(ROUTE_SANCTIONS)
    }
    // #145 : l'hôte des notices transitoires (succès, échec, annulation) — une
    // fois pour toute l'application ; `LocalPapNotice` le rend lisible partout.
    val noticeHost = rememberPapNoticeHost()
    // #263 : la porte de lecture du mouvement pour les transitions d'écrans —
    // lue UNE fois ici, les quatre transitions partagent les mêmes jetons.
    val motionOn = rememberMotionOn()
    // #266 : le comportement de rétraction de la barre du haut, PARTAGÉ entre
    // la barre et le `Scaffold`. `enterAlways` sans `nestedScroll` ne reçoit
    // aucun événement de défilement : la barre restait figée alors que
    // `AppTopBar` déclarait se rétracter. UN objet mémorisé, passé à la barre
    // ET branché ci-dessous — deux instances verraient chacune la moitié des
    // événements.
    val topBarScroll = TopAppBarDefaults.enterAlwaysScrollBehavior()
    // #134 : jetons Papillon appliqués une fois à la racine (avant : le violet
    // Material par défaut, sans typo ni forme).
    PapillonTheme(darkTheme = isDarkTheme(theme, isSystemInDarkTheme())) {
    CompositionLocalProvider(LocalPapNotice provides noticeHost) {
    Scaffold(
        modifier = Modifier.nestedScroll(topBarScroll.nestedScrollConnection),
        topBar = {
            AppTopBar(
                currentRoute,
                onNavigate = { dest -> nav.navigateTo(dest) },
                onRefresh = { readTick++ },
                hiddenDestinations = hiddenDestinations,
                headerSlot = headerSlot,
                // Retour = d'où l'on vient ; si la pile est vide (deep link
                // direct), on part vers la route mère de la route courante.
                onBack = { back -> if (!nav.popBackStack()) nav.navigateTo(back) },
                scrollBehavior = topBarScroll,
                reclaimedTop = reclaimedTop,
            )
        },
        bottomBar = { AppTabBar(currentRoute) { tab -> nav.openTab(tab) } },
        // #145 : seule porte de sortie des notices, peinte par sévérité.
        snackbarHost = { PapNoticeSnackbarHost(noticeHost) },
    ) { pad ->
        NavHost(
            navController = nav,
            // #120 : premier lancement OU session morte = l'assistant de
            // connexion, pas un Accueil qui ne peut rien afficher. #313 : la
            // décision ne se prend plus ICI — sonder la session déchiffrait
            // Keystore + EncryptedSharedPreferences sur le thread UI avant le
            // premier frame. Le graphe démarre sur l'accueil, et `SessionGate`
            // y ramène à l'appairage après la restauration (« pas de session »
            // comme « session morte » de #113).
            startDestination = ROUTE_INDEX,
            modifier = Modifier.padding(pad),
            // #263 : fondu + glissé 300 ms en entrée / 150 ms en sortie, même
            // courbe `cubicBezier(0.3, 0.3, 0, 1)` — 0 ms quand le téléphone a
            // coupé les animations (`ValueAnimator.areAnimatorsEnabled()`).
            enterTransition = { motionNavEnter(motionOn) },
            exitTransition = { motionNavExit(motionOn) },
            popEnterTransition = { motionNavPopEnter(motionOn) },
            popExitTransition = { motionNavPopExit(motionOn) },
        ) {
            composable(ROUTE_INDEX, deepLinks = listOf(routeDeepLink(ROUTE_INDEX))) {
                // #143 : l'accueil ouvre les écrans qu'il présente (widgets,
                // accès rapides) par la porte de #135 — pas de NavController ici.
                IndexScreen(repo, baseUrl, subjectPrefs) { route -> nav.navigateTo(route) }
            }
            composable(ROUTE_CALENDAR, deepLinks = listOf(routeDeepLink(ROUTE_CALENDAR))) {
                // #76 : vue semaine EDT (prof, statut annulé/déplacé, salle du
                // prochain cours, navigation de semaine, hors-ligne via cache).
                TimetableRoute(
                    repo = repo,
                    baseUrl = baseUrl,
                    subjectPrefs = subjectPrefs,
                    onSettings = { nav.navigateTo(ROUTE_SETTINGS) },
                    onPairing = { nav.navigateTo(ROUTE_PAIRING) },
                    onAlerts = { nav.navigateTo(ROUTE_ALERTS) },
                )
            }
            composable(ROUTE_GRADES, deepLinks = listOf(routeDeepLink(ROUTE_GRADES))) {
                // #139 : rendu structuré (moyennes, sparkline, contexte de
                // classe), plus de JSON brut ; #162 : plus de lien de navigation.
                GradesRoute(
                    CachePolicy.GRADES,
                    repo,
                    baseUrl,
                    subjectPrefs = subjectPrefs,
                    refreshTick = readTick,
                    // #190 : la barre du haut est plus l'unique source de son
                    // contenu — l'écran Notes y publie son nom de période et
                    // son sélecteur.
                    headerSlot = headerSlot,
                )
            }
            composable(ROUTE_TASKS, deepLinks = listOf(routeDeepLink(ROUTE_TASKS))) {
                // #75 : devoirs de la semaine (contenus + PJ lues en local),
                // toggle Optimiste avec retour arrière, pull-refresh.
                // #249 : clé LLM créée ici, pas à la racine (hors cold start).
                val llmKeys = remember(ctx) { LlmKeys.get(ctx) }
                AssignmentsRoute(
                    CachePolicy.ASSIGNMENTS,
                    repo,
                    baseUrl,
                    subjectPrefs = subjectPrefs,
                    llmKeys = llmKeys,
                )
            }
            composable(ROUTE_PROFILE, deepLinks = listOf(routeDeepLink(ROUTE_PROFILE))) {
                ProfileRoute(
                    baseUrl = baseUrl,
                    repo = profileRepo,
                    accounts = accounts,
                    onLogout = { accounts.logout() },
                    goSettings = { nav.navigateTo(ROUTE_SETTINGS) },
                    goPairing = { nav.navigateTo(ROUTE_PAIRING) },
                    goAlerts = { nav.navigateTo(ROUTE_ALERTS) },
                    goFiches = { nav.navigateTo(ROUTE_FICHES) },
                    goNews = { nav.navigateTo(ROUTE_NEWS) },
                    goCanteen = { nav.navigateTo(ROUTE_CANTEEN) },
                    goAttendance = { nav.navigateTo(ROUTE_ATTENDANCE) },
                    // #87 : entrees masquees selon les onglets actifs.
                    capabilities = capabilities,
                    onRefreshCapabilities = { detectCapabilities() },

                    goMessages = { nav.navigateTo(ROUTE_MESSAGES) },
                    refreshTick = readTick, // #140 : relecture par la barre du haut
                )
            }
            composable(ROUTE_NEWS, deepLinks = listOf(routeDeepLink(ROUTE_NEWS))) {
                NewsRoute(repo, baseUrl)
            }
            composable(ROUTE_CANTEEN, deepLinks = listOf(routeDeepLink(ROUTE_CANTEEN))) {
                CanteenRoute(repo, baseUrl)
            }
            // #77 : vie scolaire (absences/retards), puis sanctions. #172 : plus de
            // `onSanctions`/`onBack` — retour et destination sont dans la barre du
            // haut (`TOP_BARS` / `TOP_BAR_ACTIONS`), qui noue navigation ET capacité.
            composable(ROUTE_ATTENDANCE, deepLinks = listOf(routeDeepLink(ROUTE_ATTENDANCE))) {
                AttendanceRoute(repo, baseUrl)
            }
            composable(ROUTE_SANCTIONS, deepLinks = listOf(routeDeepLink(ROUTE_SANCTIONS))) {
                PunishmentsRoute(repo, baseUrl)
            }
            composable(ROUTE_SETTINGS, deepLinks = listOf(routeDeepLink(ROUTE_SETTINGS))) {
                // #249 : clé LLM créée ici, pas à la racine (hors cold start).
                // Le singleton `LlmKeys` garantit la même instance que Tâches.
                val llmKeys = remember(ctx) { LlmKeys.get(ctx) }
                var llmKeyConfigured by remember(llmKeys) { mutableStateOf(llmKeys.isConfigured()) }
                SettingsScreen( // #140 : plus de `onBack`, la barre porte la flèche
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
                    accountCount = accounts.count(), // #140 : affiché, jamais écrit
                )
            }
            composable(ROUTE_PAIRING, deepLinks = listOf(routeDeepLink(ROUTE_PAIRING))) {
                // #113 : `notice` = raison factuelle de l'arrivée ici (session
                // refusée). Pas de cause devinée, pas de bouton « réessayer » :
                // le seul geste utile est l'appairage.
                PairingRoute(
                    onBack = { nav.popBackStack() },
                    notice = authNotice,
                    // Appairage réussi = la session locale ET persistée est en
                    // place : on va droit à l'accueil. Aucun écran de
                    // confirmation à faire valider, l'utilisateur n'a plus rien
                    // à prouver.
                    onPaired = {
                        if (!nav.popBackStack(ROUTE_INDEX, inclusive = false)) {
                            nav.navigateTo(ROUTE_INDEX)
                        }
                    },
                )
            }
            composable(ROUTE_ALERTS, deepLinks = listOf(routeDeepLink(ROUTE_ALERTS))) {
                SecurityAlertsRoute(repo = repo, baseUrl = baseUrl)
            }
            // #144 : appelé SANS argument avant, donc `sheets` vide pour toujours.
            composable(ROUTE_FICHES, deepLinks = listOf(routeDeepLink(ROUTE_FICHES))) {
                RevisionSheetsRoute()
            }
            // #80 : messagerie — liste des fils (cache), lecture d'un fil, réponse,
            // création, lu/non-lu et suppression (boutons = actions confirmées, I7).
            composable(ROUTE_MESSAGES, deepLinks = listOf(routeDeepLink(ROUTE_MESSAGES))) {
                MessagesRoute(repo, baseUrl, accountId)
            }
        }
    }
    }
    }
}

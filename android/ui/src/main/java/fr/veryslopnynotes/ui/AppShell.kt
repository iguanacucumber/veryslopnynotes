package fr.veryslopnynotes.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.abs

// La COQUILLE : barre du haut et barre d'onglets. Le graphe de navigation et
// l'état de la session restent dans `AppNav.kt`, qui appelle ces deux
// composables — donc une retouche d'onglet ou de titre ne touche plus le
// fichier qui branche les écrans.
//
// #135 — ce que la coquille ne faisait pas avant :
//   - une seule barre du haut pour les 15 routes, `Text("VerySlopyNyNotes")`
//     partout, AUCUNE flèche de retour (sur `alerts`, `fiches`, `competences`,
//     `news`, `canteen`, `attendance`, on ne sortait qu'au geste système) ;
//   - le titre de la route RÉPÉTÉ dans le corps de chaque écran, à 14 sp comme
//     la barre : le même nom, deux fois, 40 px d'écart ;
//   - la barre d'onglets visible sur l'assistant d'appairage (au premier
//     lancement : 5 onglets vers une app sans serveur ni données) ;
//   - des glyphes Unicode (`"⌂"`, `"👤"`) : trois sur cinq ne changeaient pas de
//     couleur à la sélection, deux étaient des emoji que le thème ne teinte pas,
//     et la hauteur de la barre suivait la police de l'OEM. Les icônes sont
//     maintenant des `ImageVector` (`AppIcons.kt`).
//   - un slot `actions` câblé mais VIDE (#135) : les écrans gardaient leurs
//     destinations en liens en clair dans leur corps. La capture réelle de
//     l'onglet Notes (#162) les montrait sous un état d'erreur ; ils sont
//     montés ici, dans la barre, par [TOP_BAR_ACTIONS].

/** Nom de l'app : affiché seulement si une route n'a pas de titre connu. */
private const val APP_NAME = "VerySlopyNyNotes"

/**
 * Les QUATRE onglets de la référence (v8.5.5), dans son ordre : Accueil, Cours,
 * Tâches, Notes.
 *
 * #190 : avant, cinq onglets dont Profil en 5e. La référence n'a pas de 5e
 * onglet — son profil est un avatar d'en-tête et ses actualités sont une page
 * liée depuis l'accueil — donc notre barre montrait un onglet de plus qu'elle
 * et un onglet de trop : Profil, qui est devenu une destination de la barre
 * du haut de l'accueil ([TOP_BAR_ACTIONS]).
 *
 * ponytail: une liste, pas un `Tab` avec un `when` par route : l'ordre se lit
 * d'un coup d'œil, et c'est le seul endroit à changer si un jour un onglet se
 * retire (capacité dynamique).
 */
private val TAB_ROUTES = listOf(ROUTE_INDEX, ROUTE_CALENDAR, ROUTE_TASKS, ROUTE_GRADES)

/**
 * Libellé d'un onglet — et nom annoncé de son icône : les deux viennent de la
 * MÊME fonction, ils ne peuvent donc pas diverger.
 *
 * #190 : « EDT » devient « Cours », le libellé exact de la référence
 * (`Tab_Calendar`). « EDT » était une abréviation que nous avions choisie, pas
 * une valeur relevée.
 */
private fun tabLabel(route: String): String = when (route) {
    ROUTE_INDEX -> "Accueil"
    ROUTE_CALENDAR -> "Cours"
    ROUTE_GRADES -> "Notes"
    ROUTE_TASKS -> "Tâches"
    else -> route
}

/**
 * Barre d'onglets visible ? Non sur `pairing` et `settings`.
 *
 * `pairing` : au premier lancement l'utilisateur n'a NI serveur NI données, or
 * la barre lui proposait 5 onglets qui mènent tous vers des écrans vides.
 * `settings` : déjà hors onglets (on y entre depuis Profil / EDT / Notes), donc
 * garder la barre lui donnait un cinquième d'occupation sans issue.
 */
private fun showsTabBar(route: String?): Boolean =
    route != null && route != ROUTE_PAIRING && route != ROUTE_SETTINGS

/**
 * Barre du haut d'une route : titre, route de repli du retour, actions.
 *
 * [back] est la route de repli quand la pile de retour est VIDE (arrivée par
 * deep link) : le retour normal reste `popBackStack()`, donc on revient d'où
 * l'on vient ; le repli évite de laisser l'utilisateur dans un cul-de-sac.
 *
 * Les actions ne sont PAS ici : ce sont des [TopAction], la seule porte des
 * destinations d'un écran (cf. [TOP_BAR_ACTIONS] et le `why` de #162).
 */
private class TopBar(
    val title: String,
    val back: String? = null,
)

/**
 * Une action de barre du haut, de deux espèces.
 *
 * [Refresh] = RELECTURE de la ressource affichée : un geste de l'écran, pas une
 * navigation — il est donc déclenché par un compteur fourni par l'écran
 * ([AppTopBar] reçoit `onRefresh`), jamais par `navigate`.
 * [Go] = une DESTINATION, c'est-à-dire un autre écran. Elle n'a de sens que
 * dans la barre : un lien de navigation dans le corps d'un écran est un défaut
 * (#162), donc cette table est la seule porte.
 */
private sealed interface TopAction {
    data object Refresh : TopAction
    data class Go(val route: String, val label: String) : TopAction
}

/**
 * Ce que l'ÉCRAN demande à la barre du haut, publié par l'écran lui-même.
 *
 * #190 : la barre du haut était entièrement statique — une table `TOP_BARS` par
 * route — donc elle ne pouvait pas afficher ce que la référence affiche sur
 * Notes : le NOM DE LA PÉRIODE, avec un sélecteur de période à gauche. Le
 * titre et le slot de gauche viennent donc de l'écran, qui est le seul à savoir
 * quelle période est chargée.
 *
 * Publishé par `LaunchedEffect` et non par un `remember` : une écriture
 * d'état pendant la composition voit l'écran se redessiner à chaque frame
 * alors qu'aucune valeur n'a changé. Le `LaunchedEffect(header)` ne réécrit
 * que quand l'en-tête RÉELLEMENT change.
 *
 * ponytail: deux champs, pas une hiérarchie de rôles (`title`/`subtitle`/
 * `avatar`/`search`…). Un champ pour chaque ce que la référence montre sur
 * Notes ; un écran qui aura besoin d'un troisième l'ajoutera ici, prouvé par
 * son usage.
 *
 * @param title titre de l'écran, ou `null` pour celui de [TOP_BARS].
 * @param leading slot de gauche de la barre (le sélecteur de période). Sur une
 *   route secondaire, la flèche de retour reste prioritaire : sans elle on n'a
 *   plus de retour (cf. [AppTopBar]).
 */
data class PapHeader(
    val title: String? = null,
    val leading: (@Composable () -> Unit)? = null,
)

/**
 * La case « en-tête publié » de l'écran courant : un `mutableStateOf` que
 * l'écran écrit et que la barre lit.
 *
 * Un objet passé en paramètre plutôt qu'un `CompositionLocal` : il n'y a
 * qu'un lecteur (la barre) et qu'un écrivain (l'écran), tous deux câblés dans
 * `AppNav.kt` — un `Local` serait la même indirection avec une portée de plus.
 *
 * La case est KEYÉE PAR ROUTE, et c'est ce qui rend le mécanisme sûr : un
 * écran publie en partant, donc sans clé un en-tête resterait accroché à la
 * barre après le changement d'écran (le titre « Trimestre 1 » sur l'Accueil).
 * La barre ne lit donc que la case dont la route est la sienne, et une route
 * sans en-tête retombe sur [TOP_BARS] — donc l'implémentation du mécanisme et
 * son premier oubli sont le même test.
 */
@Stable
class PapHeaderSlot {
    private val published = mutableStateOf<Map<String, PapHeader>>(emptyMap())

    /** Publie l'en-tête de [route], ou l'efface si [header] est `null`. */
    fun publish(route: String, header: PapHeader?) {
        published.value = if (header == null) {
            published.value - route
        } else {
            published.value + (route to header)
        }
    }

    /** L'en-tête publié par [route], ou `null` si elle n'en a pas. */
    fun of(route: String): PapHeader? = published.value[route]
}

/**
 * Actions de la barre du haut, PAR ROUTE.
 *
 * #162 : `Actualiser`, `Compétences`, `Réglages`, `Appairage QR+PIN` et
 * `Alertes sécurité` étaient des liens en clair en bas du corps de l'onglet
 * Notes (et de Compétences), donc visibles sous un état d'erreur. Ici : une
 * icône de relecture + un menu « plus » qui garde des libellés lisibles (cinq
 * icônes dans une barre de 360 dp ne laisseraient plus de place au titre).
 *
 * Une route absente de la table n'a AUCUNE action : c'est le cas de toutes les
 * autres, qui portent leurs propres boutons d'état (filtres, Messages) sans
 * destination à offrir.
 *
 * ponytail: une liste, pas un `when` par route — comme [TAB_ROUTES], le seul
 * endroit à regarder pour savoir quelles destinations existent.
 */
private val TOP_BAR_ACTIONS: Map<String, List<TopAction>> = mapOf(
    // #190 : Profil sort de la barre d'onglets (la référence n'a que quatre
    // onglets, son profil est un avatar d'en-tête) et devient une destination
    // de l'ACCUEIL — donc là où l'on entre quand on n'a pas d'onglet Profil
    // sur lequel cliquer. C'est la seule porte : `TOP_BARS` porte son titre et
    // sa flèche de retour vers l'accueil.
    ROUTE_INDEX to listOf(
        TopAction.Go(ROUTE_PROFILE, "Profil"),
    ),
    // #140 : le profil se relit depuis la barre, donc le corps de l'écran
    // n'affiche plus son bouton « Charger le profil » : c'est la seule route
    // qui n'offre aucune destination ET dont la donnée est en mémoire (jamais
    // en cache), donc la relecture est le geste le plus demandé de cet écran.
    ROUTE_PROFILE to listOf(
        TopAction.Refresh,
    ),
    ROUTE_GRADES to listOf(
        TopAction.Refresh,
        TopAction.Go(ROUTE_SETTINGS, "Réglages"),
        TopAction.Go(ROUTE_PAIRING, "Appairage QR+PIN"),
        TopAction.Go(ROUTE_ALERTS, "Alertes sécurité"),
    ),
    // #172 : « Sanctions » sort du CORPS de la Vie scolaire (c'était le dernier
    // lien de navigation en clair d'un écran) et devient une action de barre.
    // La capacité `punishments` (#87) reste le filtre : c'est
    // `AppNav.kt` qui la range dans `hiddenDestinations`, seul endroit qui sait
    // lire les capacités ET naviguer. Pas de relecture ici : le bouton
    // d'en-tête de l'écran la porte déjà (`AttendanceHeader`).
    ROUTE_ATTENDANCE to listOf(
        TopAction.Go(ROUTE_SANCTIONS, "Sanctions"),
    ),
)

private val TOP_BARS: Map<String, TopBar> = mapOf(
    // Racines d'onglets : pas de flèche (retour = quitter l'app), pas d'action.
    ROUTE_INDEX to TopBar("Accueil"),
    ROUTE_CALENDAR to TopBar("Cours"),
    ROUTE_TASKS to TopBar("Tâches"),
    // #190 : le titre « Notes » n'est plus qu'un REPLI. L'écran Notes publie
    // le nom de la période sélectionnée (cf. [PapHeader]) ; sans période
    // chargée, on affiche ce qu'affiche la référence avant son premier
    // chargement : `t('Tab_Grades')`, soit « Notes ».
    ROUTE_GRADES to TopBar("Notes"),
    // Secondaires : flèche de retour systématique. #190 : le profil n'est plus
    // une racine d'onglet, donc il se range avec les autres et pointe vers
    // l'accueil — sans ça, on arrivait dessus sans jamais pouvoir revenir.
    // Les Actualités suivent le profil parce que c'est de là qu'on y entre.
    ROUTE_PROFILE to TopBar("Profil", back = ROUTE_INDEX),
    ROUTE_NEWS to TopBar("Actualités", back = ROUTE_PROFILE),
    ROUTE_CANTEEN to TopBar("Cantine", back = ROUTE_PROFILE),
    ROUTE_ATTENDANCE to TopBar("Vie scolaire", back = ROUTE_PROFILE),
    ROUTE_SANCTIONS to TopBar("Sanctions", back = ROUTE_ATTENDANCE),
    ROUTE_MESSAGES to TopBar("Messages", back = ROUTE_PROFILE),
    ROUTE_ALERTS to TopBar("Alertes sécurité", back = ROUTE_INDEX),
    ROUTE_FICHES to TopBar("Fiches révision", back = ROUTE_PROFILE),
    ROUTE_SETTINGS to TopBar("Réglages", back = ROUTE_INDEX),
    // Premier lancement : il n'y a rien derrière l'assistant, donc pas de
    // flèche — une flèche qui ne sort pas de l'app vaut moins qu'aucune.
    ROUTE_PAIRING to TopBar("Appairage"),
)

/**
 * Hauteur de contenu de la barre du haut : celle de M3
 * (`TopAppBarSmallTokens.ContainerHeight`, 64 dp).
 *
 * #323 : c'est la SEULE hauteur, plus « 64 dp + la barre de statut » (#305).
 * Le contenu d'une barre de 64 dp est centré à 32 dp du bord, exactement la
 * ligne du poinçon de l'appareil (mesuré : centre de la caméra à 32,7 dp) —
 * la barre est plus courte et son titre retombe sur l'encoche au lieu de
 * flotter dessous.
 *
 * ponytail: une constante de fichier, pas un paramètre : c'est la hauteur de M3
 * et l'app n'a qu'une barre du haut. Le jour où une seconde existe, elle passe
 * en paramètre.
 */
private val TopBarContentHeight = 64.dp

/**
 * Marges horizontales de M3, aux mêmes valeurs que lui : 4 dp autour des icônes
 * (`TopAppBarHorizontalPadding`) et 12 dp de décalage du titre quand rien ne le
 * précède (`TopAppBarTitleInset` = 16 dp - 4 dp) — soit un titre à 16 dp du bord
 * sur les routes racines, la valeur des captures de #135.
 */
private val TopBarIconInset = 4.dp
private val TopBarTitleInset = 12.dp

/**
 * Barre du haut de la route courante. [onBack] reçoit la route de repli, jamais
 * la route courante : c'est `AppNav` qui décide entre revenir en arrière
 * (`popBackStack`, donc d'où l'on vient) et naviguer quand la pile est vide.
 *
 * [onNavigate] et [onRefresh] n'ont pas de valeur par défaut : une action qui ne
 * peut pas agir ne doit pas s'afficher, donc oublier de les câbler est une
 * erreur de compilation, pas un bouton mort.
 *
 * [hiddenDestinations] retire des destinations de la barre quand l'écran ne
 * doit pas les offrir (#87 : l'onglet Compétences n'existe que si
 * l'établissement active les évaluations, la route Sanctions que s'il publie
 * `punishments`). La table est statique, c'est donc `AppNav` — qui lit les
 * capacités — qui décide.
 *
 * [scrollBehavior] est le comportement de rétraction AU DÉFILEMENT : il est
 * créé ici par défaut (`enterAlways`, la barre revient dès qu'on remonte) mais
 * `AppNav` en fournit UN partagé ET le branche sur le `Scaffold` via
 * `Modifier.nestedScroll` — sans cette connexion, la barre ne reçoit aucun
 * événement de défilement et ne se rétracte jamais.
 *
 * #303 : la barre occupe la place de la barre de statut qu'elle a fait
 * disparaître. #323 : elle garde la hauteur de M3 (64 dp) et n'y ajoute RIEN :
 * centré dans ces 64 dp, le contenu tombe sur la ligne du poinçon. La hauteur
 * de `TopAppBar` de M3 est figée à 64 dp (aucun paramètre pour la régler), donc
 * la rangée est montée ici, avec la même structure que la sienne : mêmes marges,
 * mêmes couleurs (`TopAppBarDefaults.topAppBarColors()`), même rétraction au
 * défilement (1 px de défilement = 1 px de barre) et même repli au geste.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppTopBar(
    route: String?,
    onBack: (String) -> Unit,
    onNavigate: (String) -> Unit,
    onRefresh: () -> Unit,
    hiddenDestinations: Set<String> = emptySet(),
    // #190 : l'en-tête que l'ÉCRAN a publié pour CETTE route (cf. [PapHeader]).
    // Un `PapHeaderSlot` vide par défaut, donc un appel qui oublie le mécanisme
    // compile et rend la table statique — le cas simple reste le cas simple.
    headerSlot: PapHeaderSlot? = null,
    scrollBehavior: TopAppBarScrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior(),
) {
    val bar = route?.let { TOP_BARS[it] }
    // Titre publié par l'écran > titre de la table > nom de l'app. L'ordre est
    // ce qu'il est : un écran qui sait dire quelle période est chargée doit
    // être cru sur parole.
    val published = route?.let { headerSlot?.of(it) }
    // La flèche reste PRIORITAIRE sur un `leading` publié : sans elle, un écran
    // secondaire n'aurait plus de retour. Les deux ne se croisent donc pas sur
    // Notes (route racine, pas de flèche) — l'ordre est écrit parce qu'un jour
    // ils se croiseront.
    val back = bar?.back
    val leading = published?.leading
    val actions = route
        ?.let { TOP_BAR_ACTIONS[it] }
        .orEmpty()
        .filterNot { it is TopAction.Go && it.route in hiddenDestinations }
    val density = LocalDensity.current
    val state = scrollBehavior.state
    val contentHeightPx = with(density) { TopBarContentHeight.toPx() }
    // #323 : l'encoche ne protège que les CÔTÉS. Une découpe haute (poinçon) est
    // au CENTRE de la barre, là où il n'y a rien — titre à gauche, actions à
    // droite — et son inset vaut la barre de statut entière (57 dp mesurés) :
    // le consommer en hauteur ne protégeait rien, il poussait juste le contenu
    // sous l'encoche et rallongeait la barre (#305/#307). En paysage la découpe
    // est sur un bord, donc la marge horizontale reste.
    val cutout = WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)
    // La barre se rétracte quand on défile vers le bas et revient dès qu'on
    // remonte : le défilement vient des écrans, pas l'inverse. Le [scrollBehavior]
    // est celui branché par `AppNav` sur le `Scaffold` (`nestedScroll`) : le
    // défaut ci-dessus garde l'appel simple (previews, tests) sans changer
    // l'espèce de la barre.
    SideEffect {
        if (state.heightOffsetLimit != -contentHeightPx) state.heightOffsetLimit = -contentHeightPx
    }
    // Couleur de fond : celle de M3 — surface, puis conteneur « défilé » dès que
    // du contenu passe derrière la barre. `TopAppBarColors.containerColor(fraction)`
    // est INTERNE à material3 1.2.1, donc l'interpolation est écrite ici, sur
    // ses deux couleurs publiques.
    val colors = TopAppBarDefaults.topAppBarColors()
    val overlapped = state.overlappedFraction > 0.01f
    val containerColor by animateColorAsState(
        targetValue = lerp(colors.containerColor, colors.scrolledContainerColor, if (overlapped) 1f else 0f),
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
    )
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            // Replier la barre au GESTE, comme M3 : même déplacement que le
            // défilement, au doigt. `settleAppBar` est interne, donc son
            // enchaînement est réécrit dans [settleTopBar], à l'identique.
            .draggable(
                orientation = Orientation.Vertical,
                enabled = !scrollBehavior.isPinned,
                state = rememberDraggableState { delta -> state.heightOffset += delta },
                onDragStopped = { velocity -> settleTopBar(scrollBehavior, velocity) },
            ),
        color = containerColor,
    ) {
        Row(
            modifier = Modifier
                // L'encoche ne mord que sur les côtés (cf. [cutout] plus haut).
                .windowInsetsPadding(cutout)
                .fillMaxWidth()
                // Rogner DANS la hauteur de la barre : au défilement, le titre
                // sort au lieu de déborder sur le contenu.
                .clipToBounds()
                // La hauteur de contenu SUIT le repli : la barre libère sa
                // place au lieu de la recouvrir, et le `Scaffold` en fait
                // autant pour l'écran en dessous.
                .height(with(density) { (contentHeightPx + state.heightOffset).coerceAtLeast(0f).toDp() }),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (back != null) {
                Box(Modifier.padding(start = TopBarIconInset)) {
                    CompositionLocalProvider(LocalContentColor provides colors.navigationIconContentColor) {
                        IconButton(onClick = { onBack(back) }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                        }
                    }
                }
            } else if (leading != null) {
                Box(Modifier.padding(start = TopBarIconInset)) {
                    CompositionLocalProvider(LocalContentColor provides colors.navigationIconContentColor) {
                        leading()
                    }
                }
            }
            // Titre de la ROUTE (papillon.bzh), plus la marque : avant #135
            // c'était « VerySlopyNyNotes » sur les 15 routes. `titleLarge` =
            // 18 sp gras, l'échelle de #134 — le texte le plus visible de
            // l'écran.
            CompositionLocalProvider(LocalContentColor provides colors.titleContentColor) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(
                            start = if (back != null || leading != null) TopBarIconInset else TopBarTitleInset + TopBarIconInset,
                            end = TopBarIconInset,
                        ),
                ) {
                    // `heading()` : le titre de la barre est le TITRE DE
                    // L'ÉCRAN. TalkBack le propose dans son menu « titres » et
                    // s'y positionne au double toucher — sans ça, les quinze
                    // routes n'avaient aucun point d'entrée dans la navigation
                    // par titres.
                    Text(
                        // #190 : le nom de la période sur Notes, le titre de la
                        // table partout ailleurs.
                        text = published?.title ?: bar?.title ?: APP_NAME,
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { heading() },
                    )
                }
            }
            // Slot d'actions contextuelles, une seule source : `TOP_BAR_ACTIONS`.
            CompositionLocalProvider(LocalContentColor provides colors.actionIconContentColor) {
                Box(Modifier.padding(end = TopBarIconInset)) {
                    TopBarActions(actions = actions, onNavigate = onNavigate, onRefresh = onRefresh)
                }
            }
        }
    }
}

/**
 * Pose la barre après un repli au GESTE : décélération du lancer, puis bord le
 * plus proche.
 *
 * Réécrit l'enchaînement de `settleAppBar` de M3 (interne à material3 1.2.1) :
 * même fling, même cible (`collapsedFraction`), même arrêt si la barre touche
 * un bord avant la fin de la décélération.
 */
@OptIn(ExperimentalMaterial3Api::class)
private suspend fun settleTopBar(scrollBehavior: TopAppBarScrollBehavior, velocity: Float) {
    val state = scrollBehavior.state
    val fling = scrollBehavior.flingAnimationSpec
    val snap = scrollBehavior.snapAnimationSpec
    if (fling != null && abs(velocity) > 1f) {
        var last = 0f
        AnimationState(initialValue = 0f, initialVelocity = velocity).animateDecay(fling) {
            val delta = value - last
            val before = state.heightOffset
            state.heightOffset = before + delta
            last = value
            // Bord atteint : `heightOffset` est borné, donc le déplacement réel
            // ne suit plus la décélération et il n'y a plus rien à pousser.
            if (abs(delta - (state.heightOffset - before)) > 0.5f) cancelAnimation()
        }
    }
    if (snap != null && state.heightOffset < 0f && state.heightOffset > state.heightOffsetLimit) {
        animate(
            initialValue = state.heightOffset,
            targetValue = if (state.collapsedFraction < 0.5f) 0f else state.heightOffsetLimit,
            animationSpec = snap,
        ) { value, _ -> state.heightOffset = value }
    }
}

/**
 * Rendu des actions de la barre : la RELECTURE en icône (le geste le plus
 * demandé sur un écran de données), les DESTINATIONS dans le menu « plus ».
 *
 * Cinq icônes de 48 dp ne laisseraient plus de place au titre sur un écran de
 * 360 dp, et « Appairage QR+PIN » n'a pas d'icône dans `material-icons-core` ;
 * le menu garde des libellés écrits, donc rien à deviner.
 */
@Composable
private fun TopBarActions(
    actions: List<TopAction>,
    onNavigate: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    if (actions.isEmpty()) return
    var menuOpen by remember { mutableStateOf(false) }
    val destinations = actions.filterIsInstance<TopAction.Go>()
    if (actions.any { it is TopAction.Refresh }) {
        IconButton(onClick = onRefresh) {
            Icon(Icons.Filled.Refresh, contentDescription = "Actualiser")
        }
    }
    if (destinations.isEmpty()) return
    Box {
        IconButton(onClick = { menuOpen = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = "Plus d'actions")
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            for (destination in destinations) {
                DropdownMenuItem(
                    text = {
                        Text(
                            text = destination.label,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    onClick = {
                        menuOpen = false
                        onNavigate(destination.route)
                    },
                )
            }
        }
    }
}

/**
 * Icône d'un onglet et sa pastille.
 *
 * material3 1.2.1 n'a PAS de paramètre `badge` sur `NavigationBarItem` (il est
 * arrivé après le gel du Compose BOM 2024.06.00) : la pastille se pose donc par
 * `BadgedBox` autour de l'icône, ce qui est exactement ce que fera la version
 * de Material qui exposera le paramètre. Le point de branchement reste
 * [tabBadge], donc le jour où le BOM bouge il n'y a qu'à supprimer cette
 * fonction et passer `badge = tabBadge(tab)` à l'item.
 *
 * `null` = pas de pastille : une icône seule, sans `BadgedBox` inutile.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TabIconWithBadge(route: String, icon: @Composable () -> Unit) {
    val badge = tabBadge(route)
    if (badge == null) icon() else BadgedBox(badge = badge) { icon() }
}

/**
 * Barre d'onglets de la route courante, ou RIEN si la route l'interdit.
 *
 * Pastille flottante façon Papillon : un `Surface` arrondi posé sur un `Box`
 * paddé, pas un dock plein-bleed. La `NavigationBar` intérieure est
 * transparente (ni fond ni élévation propres) : c'est la pastille qui porte
 * la surface et l'ombre. L'indicateur de sélection est la pastille M3
 * (capsule arrondie par défaut) teintée `secondaryContainer` : vert pâle en
 * clair, conteneur vert sombre en sombre (un seul jeton depuis #261, 5,19:1
 * dans les deux thèmes) — plus de branche par thème ici. Quatre onglets
 * seulement : un 5e "Actualités" serait routage + capacités, pas style.
 */
@Composable
fun AppTabBar(route: String?, onSelect: (String) -> Unit) {
    if (!showsTabBar(route)) return
    val scheme = MaterialTheme.colorScheme
    val indicatorContainer = scheme.secondaryContainer
    val indicatorInk = scheme.onSecondaryContainer
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
    ) {
        Surface(
            shape = MaterialTheme.shapes.extraLarge,
            color = scheme.surface,
            // Pas de teinte tonale : `tonalElevation` M3 teinte la surface avec
            // la couleur primaire (ici un vert), donc la barre flotterait en
            // vert pâle au lieu du blanc/surface de la référence. Le relief
            // vient de l'ombre seule.
            tonalElevation = 0.dp,
            shadowElevation = 6.dp,
        ) {
            NavigationBar(
                containerColor = Color.Transparent,
                tonalElevation = 0.dp,
            ) {
                for (tab in TAB_ROUTES) {
                    NavigationBarItem(
                        selected = route == tab,
                        onClick = { onSelect(tab) },
                        label = { Text(tabLabel(tab)) },
                        icon = {
                            TabIconWithBadge(tab) {
                                Icon(
                                    // #135 : `ImageVector` teinté par le thème au lieu
                                    // du glyphe Unicode `"⌂"` / `"👤"`.
                                    imageVector = tabIcon(tab),
                                    // #146 : `null`, donc DÉCORATIF. Le libellé est déjà
                                    // rendu sous l'icône par le `label` de l'item, et
                                    // `NavigationBarItem` ne fusionne pas les deux nœuds :
                                    // avec un `contentDescription`, TalkBack annonçait
                                    // « Accueil … Accueil ». Le nom vient donc du SEUL
                                    // endroit qui le prononce, `tabLabel`.
                                    contentDescription = null,
                                )
                            }
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = indicatorInk,
                            selectedTextColor = indicatorInk,
                            indicatorColor = indicatorContainer,
                            unselectedIconColor = scheme.onSurfaceVariant,
                            unselectedTextColor = scheme.onSurfaceVariant,
                        ),
                    )
                }
            }
        }
    }
}

/**
 * Pastille d'un onglet : `null` = pas de pastille.
 *
 * #135 : le `NavigationBarItem` a désormais son paramètre `badge` branché, donc
 * le compteur n'existera plus comme habillage : la seule chose à écrire est le
 * `when` ci-dessous. Vide aujourd'hui : aucun compteur n'est calculé nulle
 * part, et en inventer un serait afficher un nombre faux.
 *
 * ponytail: pas de compteur « parce que la place existe ». Upgrade : le
 * compteur vient d'un état réel, jamais d'un nombre codé en dur.
 */
@Suppress("UNUSED_PARAMETER")
private fun tabBadge(route: String): (@Composable BoxScope.() -> Unit)? = null
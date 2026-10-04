package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow

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
 * Onglets dans l'ordre de Papillon : Accueil, EDT, Tâches, Notes, Profil.
 * #135 : avant, c'était Accueil, Calendrier, Notes, Tâches, Profil — Notes et
 * Tâches étaient inversés par rapport à papillon.bzh.
 *
 * ponytail: une liste, pas un `Tab` avec un `when` par route : l'ordre se lit
 * d'un coup d'œil, et c'est le seul endroit à changer si un jour un onglet se
 * retire (capacité dynamique).
 */
private val TAB_ROUTES = listOf(ROUTE_INDEX, ROUTE_CALENDAR, ROUTE_TASKS, ROUTE_GRADES, ROUTE_PROFILE)

/**
 * Libellé d'un onglet — et nom annoncé de son icône : les deux viennent de la
 * MÊME fonction, ils ne peuvent donc pas diverger.
 */
private fun tabLabel(route: String): String = when (route) {
    ROUTE_INDEX -> "Accueil"
    ROUTE_CALENDAR -> "EDT"
    ROUTE_GRADES -> "Notes"
    ROUTE_TASKS -> "Tâches"
    ROUTE_PROFILE -> "Profil"
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
    // #140 : le profil se relit depuis la barre, donc le corps de l'écran
    // n'affiche plus son bouton « Charger le profil » : c'est la seule route
    // qui n'offre aucune destination ET dont la donnée est en mémoire (jamais
    // en cache), donc la relecture est le geste le plus demandé de cet écran.
    ROUTE_PROFILE to listOf(
        TopAction.Refresh,
    ),
    ROUTE_GRADES to listOf(
        TopAction.Refresh,
        TopAction.Go(ROUTE_COMPETENCES, "Compétences"),
        TopAction.Go(ROUTE_SETTINGS, "Réglages"),
        TopAction.Go(ROUTE_PAIRING, "Appairage QR+PIN"),
        TopAction.Go(ROUTE_ALERTS, "Alertes sécurité"),
    ),
    // Même écran en cache que l'onglet Notes, donc mêmes destinations — sans
    // Compétences elle-même, et #87 peut la retirer des deux (onglet inactif).
    ROUTE_COMPETENCES to listOf(
        TopAction.Refresh,
        TopAction.Go(ROUTE_SETTINGS, "Réglages"),
        TopAction.Go(ROUTE_PAIRING, "Appairage QR+PIN"),
        TopAction.Go(ROUTE_ALERTS, "Alertes sécurité"),
    ),
)

private val TOP_BARS: Map<String, TopBar> = mapOf(
    // Racines d'onglets : pas de flèche (retour = quitter l'app), pas d'action.
    ROUTE_INDEX to TopBar("Accueil"),
    ROUTE_CALENDAR to TopBar("EDT"),
    ROUTE_TASKS to TopBar("Tâches"),
    ROUTE_GRADES to TopBar("Notes"),
    ROUTE_PROFILE to TopBar("Profil"),
    // Secondaires : flèche de retour systématique.
    ROUTE_NEWS to TopBar("Actualités", back = ROUTE_PROFILE),
    ROUTE_CANTEEN to TopBar("Cantine", back = ROUTE_PROFILE),
    ROUTE_ATTENDANCE to TopBar("Vie scolaire", back = ROUTE_PROFILE),
    ROUTE_SANCTIONS to TopBar("Sanctions", back = ROUTE_ATTENDANCE),
    ROUTE_MESSAGES to TopBar("Messages", back = ROUTE_PROFILE),
    ROUTE_ALERTS to TopBar("Alertes sécurité", back = ROUTE_INDEX),
    ROUTE_FICHES to TopBar("Fiches révision", back = ROUTE_PROFILE),
    ROUTE_COMPETENCES to TopBar("Compétences", back = ROUTE_GRADES),
    ROUTE_SETTINGS to TopBar("Réglages", back = ROUTE_INDEX),
    // Premier lancement : il n'y a rien derrière l'assistant, donc pas de
    // flèche — une flèche qui ne sort pas de l'app vaut moins qu'aucune.
    ROUTE_PAIRING to TopBar("Appairage"),
)

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
 * l'établissement active les évaluations). La table est statique, c'est donc
 * `AppNav` — qui lit les capacités — qui décide.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppTopBar(
    route: String?,
    onBack: (String) -> Unit,
    onNavigate: (String) -> Unit,
    onRefresh: () -> Unit,
    hiddenDestinations: Set<String> = emptySet(),
) {
    val bar = route?.let { TOP_BARS[it] }
    val actions = route
        ?.let { TOP_BAR_ACTIONS[it] }
        .orEmpty()
        .filterNot { it is TopAction.Go && it.route in hiddenDestinations }
    // La barre se rétracte quand on défile vers le bas et revient dès qu'on
    // remonte : le défilement vient des écrans, pas l'inverse.
    TopAppBar(
        // Titre de la ROUTE (papillon.bzh), plus la marque : avant #135 c'était
        // « VerySlopyNyNotes » sur les 15 routes. `titleLarge` = 18 sp gras,
        // l'échelle de #134 — le texte le plus visible de l'écran.
        title = {
            // `heading()` : le titre de la barre est le TITRE DE L'ÉCRAN. TalkBack
            // le propose dans son menu « titres » et s'y positionne au double
            // toucher — sans ça, les quinze routes n'avaient aucun point d'entrée
            // dans la navigation par titres.
            Text(
                text = bar?.title ?: APP_NAME,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
        },
        navigationIcon = {
            val back = bar?.back
            if (back != null) {
                IconButton(onClick = { onBack(back) }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                }
            }
        },
        // Slot d'actions contextuelles, une seule source : `TOP_BAR_ACTIONS`.
        actions = { TopBarActions(actions = actions, onNavigate = onNavigate, onRefresh = onRefresh) },
        scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior(),
    )
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

/** Barre d'onglets de la route courante, ou RIEN si la route l'interdit. */
@Composable
fun AppTabBar(route: String?, onSelect: (String) -> Unit) {
    if (!showsTabBar(route)) return
    NavigationBar {
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
            )
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
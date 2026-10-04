package fr.veryslopnynotes.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Star
import androidx.compose.ui.graphics.vector.ImageVector

// Icônes d'onglets #135.
//
// AVANT : des glyphes Unicode (`"⌂"`, `"📅"`, `"★"`, `"✓"`, `"👤"`, voir
// `tabIcon()` dans AppNav.kt). Trois sur cinq ne changeaient pas de couleur à la
// sélection, deux étaient des emoji MULTI-COLORES que le thème ne teinte pas,
// et la hauteur de la barre suivait la police de l'OEM. Le `ponytail:` d'alors
// disait « pas d'Icon library avant besoin prouvé » : le besoin est prouvé
// (glyphes qui ne se teintent pas, hauteur instable), et la bibliothèque est
// DÉJÀ dans le graphe — `material-icons-core` arrive par material3, cf. le
// garde-fou qui FIGE la liste des modules Gradle de `ui` : aucune ligne de
// dépendance ajoutée.
//
// Un `ImageVector` est monochrome : la couleur vient du `Icon` qui le rend,
// donc du thème (material3 teinte l'onglet sélectionné via
// `secondaryContainer`/`onSecondaryContainer`). 24 dp = taille par défaut d'un
// `Icon` sans `Modifier.size`, donc lisible tel quel.
//
// ponytail: `Icons.Filled.*` du CORE (49 icônes), pas
// `material-icons-extended` (plus de 10 000) : les cinq routes d'onglets s'y
// trouvent déjà. Upgrade : une icône plus juste pour une route = une ligne dans
// [tabIcon], une fois le besoin prouvé — pas une collection d'icônes à choisir.

/**
 * Icône d'un onglet. [route] : une constante `ROUTE_*` (les seules rendues
 * sont celles de `TAB_ROUTES`).
 *
 * Retour `Info` pour une route inconnue : inatteignable aujourd'hui (la barre
 * d'onglets ne rend que `TAB_ROUTES`), mais une fonction totale vaut mieux
 * qu'une exception sur une chaîne.
 */
fun tabIcon(route: String): ImageVector = when (route) {
    ROUTE_INDEX -> Icons.Filled.Home
    ROUTE_CALENDAR -> Icons.Filled.DateRange
    ROUTE_TASKS -> Icons.Filled.CheckCircle
    ROUTE_GRADES -> Icons.Filled.Star
    ROUTE_PROFILE -> Icons.Filled.Person
    else -> Icons.Filled.Info
}

// Le `contentDescription` de l'icône est `tabLabel(route)` : le libellé affiché
// sous l'icône et celui lu par un lecteur d'écran viennent donc de la MÊME
// fonction, ils ne peuvent pas diverger.
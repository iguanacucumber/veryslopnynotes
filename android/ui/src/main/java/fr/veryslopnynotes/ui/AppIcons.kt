package fr.veryslopnynotes.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
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
// LES QUATRE GLYPHES SONT CEUX DE PAPILLON (`PapillonIcons.kt`) : l'icône d'un
// onglet EST le logo, et `Icons.Filled.Star` pour « Notes » (étoile = favori)
// ou `Icons.Filled.DateRange` pour les cours ne se ressemblent pas de ce que
// Papillon pose. Un écart de ce niveau se voit d'un coup d'œil, donc il est
// écrit : le CINQUIÈME onglet, Profil, garde `Icons.Filled.Person` parce que
// Papillon n'a pas de 5e onglet (son profil est un avatar d'en-tête) et qu'il
// n'y a donc rien à relever.
//
// ponytail: `Icons.Filled.*` du CORE (49 icônes) pour ce qui n'a pas de
// glyphe de référence, et quatre `ImageVector` écrits à la main pour le reste —
// PAS `material-icons-extended` (plus de 10 000 icônes, dont un camembert qui
// ferait exactement Notes) : une dépendance de plus pour une image serait le
// mauvais échange. Upgrade : un glyph de plus = un `path` de plus dans
// `PapillonIcons.kt`, une fois le besoin prouvé — pas une collection à choisir.

/**
 * Icône d'un onglet. [route] : une constante `ROUTE_*` (les seules rendues
 * sont celles de `TAB_ROUTES`).
 *
 * Retour `Info` pour une route inconnue : inatteignable aujourd'hui (la barre
 * d'onglets ne rend que `TAB_ROUTES`), mais une fonction totale vaut mieux
 * qu'une exception sur une chaîne.
 */
fun tabIcon(route: String): ImageVector = when (route) {
    ROUTE_INDEX -> PapillonTabAccueil
    ROUTE_CALENDAR -> PapillonTabCours
    ROUTE_TASKS -> PapillonTabTaches
    ROUTE_GRADES -> PapillonTabNotes
    // ÉCART ÉCRIT : Papillon n'a pas de 5e onglet — son profil est un avatar
    // dans l'en-tête. Il n'y a donc aucun glyphe à relever ici, et `Person` du
    // CORE reste le meilleur glyphe disponible (cf. le KDoc du fichier).
    ROUTE_PROFILE -> Icons.Filled.Person
    else -> Icons.Filled.Info
}

// Le nom de l'onglet est `tabLabel(route)` : le libellé affiché sous l'icône et
// celui lu par un lecteur d'écran viennent donc de la MÊME fonction, ils ne
// peuvent pas diverger. #146 : c'est le `label` de l'item qui le porte, donc le
// `contentDescription` de l'icône est `null` — la décrire en plus ferait
// annoncer le même mot deux fois.
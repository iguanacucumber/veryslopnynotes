package fr.veryslopnynotes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SubjectPrefs
import java.time.ZoneId

// L'ACCUEIL TEL QU'IL EST #143 : des CARTES, plus un digest de texte.
//
// AVANT (`IndexScreen.kt` #82) : des libellés de section, des `Text` en pleine
// largeur et trois boutons « Ouvrir … ». Rien n'était cliquable sauf ces trois
// boutons, la racine était un `Column` en `fillMaxSize` SANS défilement (une
// semaine de contenu débordait, tronqué), et `HomeLessonUi.end` comme
// `HomeGradeUi.date` étaient analysés puis jamais affichés.
//
// Ce fichier est l'habillage : cartes, en-tête « Afficher plus », carte de
// cours. Les DONNÉES sont dans `HomeWidgets.kt`, la page dans `IndexScreen.kt`.
// Rien n'est inventé ici : une couleur est soit un rôle du thème, soit la
// palette matière de `PapillonTheme.kt` passée par `subjectStyle`.
//
// ponytail: pas de bibliothèque d'icônes supplémentaire (`Restaurant`,
// `School`, `OpenInNew` vivent dans `material-icons-extended`, INTERDIT ici :
// plus de 10 000 icônes pour trois glyphes). Les icônes sont celles du CORE,
// déjà dans le graphe via material3 ; « Cantine » prend donc `Menu` et « Vie
// scolaire » `Warning`, les deux glyphes du core les plus proches.
// Upgrade: quand le BOM bougera, une ligne d'import par icône — pas de
// collection à rejouer.

/** Côte de la pastille d'un accès rapide. */
private val HOME_ACTION_ICON = 36.dp

/** Côte du glyphe dans la pastille : 36 − 2 × 6 de marge, comme sur les onglets. */
private val HOME_ACTION_GLYPH = 24.dp

/** Espace entre la pastille d'un accès rapide et son titre. */
private val HOME_ACTION_GAP = 10.dp

/**
 * Carte widget : en-tête (icône + titre en encre secondaire, le parti pris
 * Papillon « moins saillant que le corps ») puis le CONTENU.
 *
 * [onClick] rend la carte entière cliquable : #143 veut qu'un appui sur la carte
 * ouvre l'écran, pas seulement sur le bouton de droite. [onMore] pose ce bouton
 * « Afficher plus ↗ » ; il est absent = pas de bouton, jamais un bouton vide.
 */
@Composable
fun HomeWidgetCard(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    onMore: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    // Papillon pose ses cartes en blanc sur le fond blanc, séparées par la
    // bordure du thème : c'est `surface`, pas `surfaceVariant` (gris).
    PapCard(modifier = modifier, onClick = onClick, containerColor = MaterialTheme.colorScheme.surface) {
        val more = onMore
        // Un slot unique qui ne rend RIEN sans callback : `PapSectionHeader`
        // invoque le slot s'il est présent, donc « absent » = rendu vide, et pas
        // un bouton sans cible (l'équivalent de son `onClick` nul).
        PapSectionHeader(
            icon = icon,
            title = title,
            action = { if (more != null) HomeMoreButton(more) },
        )
        // `Column` et non `Box` : `content` est une lambda à receveur
        // `ColumnScope`, donc seul un `Column` peut l'invoquer ici.
        Column(modifier = Modifier.padding(top = 10.dp)) { content() }
    }
}

/**
 * « Afficher plus ↗ » : pastille bordée, rayon 20, une seule ligne.
 *
 * Le rayon 20 est celui de la pastille matière du thème (`shapes.large`) ; la
 * bordure 1 dp vient de `outline`, comme sur les cartes. La flèche est un
 * glyphe de TEXTE (donc teinté par la couleur du `Text`), pas une icône : le
 * core n'a pas d'`OpenInNew` sans `material-icons-extended`.
 *
 * #146 : deux corrections d'accessibilité, zéro pixel de design.
 *   - la cible fait [TouchTarget] (48 dp de haut) au lieu de ~25 dp : le
 *     `defaultMinSize` vient AVANT le `clip`, donc il étire la pastille bordée
 *     elle-même — le bouton paraît plus haut, mais la zone d'appui devient
 *     celle qu'on voit ;
 *   - `Role.Button` + `onClickLabel` : c'est une navigation déguisée en pastille,
 *     donc un lecteur d'écran doit l'annoncer comme un bouton qui ouvre l'écran ;
 *   - la flèche « ↗ » est son propre `Text` en `clearAndSetSemantics` :
 *     décorative, elle ne doit pas être lue (« flèche vers le haut à droite »)
 *     alors que le libellé porte déjà tout le sens.
 */
@Composable
fun HomeMoreButton(onClick: () -> Unit, label: String = "Afficher plus") {
    val shape = RoundedCornerShape(20.dp)
    val ink = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .defaultMinSize(minHeight = TouchTarget)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outline, shape)
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        // Décorative : la direction est dans le libellé, pas dans l'oral.
        Text(
            text = " ↗",
            style = MaterialTheme.typography.labelSmall,
            color = ink,
            modifier = Modifier.clearAndSetSemantics { },
        )
    }
}

/**
 * Carte de cours compacte : matière, salle, et l'heure de DÉBUT **et** de FIN.
 *
 * #82 parsait `end` et ne l'affichait nulle part ; « 08:00–09:00 » est l'information
 * qui manque le plus sur un écran d'accueil (la fin dit si on a raté le cours).
 *
 * Compteur à rebours (`countdown`) sous les horaires : `relativeTimeFr` du
 * module, donc « dans 12 min », « dans 3 h », « demain 08:00 » — jamais un ISO.
 * Vide = pas de compteur, pas une ligne vide.
 *
 * ponytail: c'est la carte de cours de l'accueil, PAS celle de l'EDT (#136/#137
 *   produit `PapCourseCard`). Deux cibles, deux fichiers : quand #137 est mergé,
 *   cette fonction se remplace par un appel — le reste de l'accueil n'y touche
 *   pas.
 */
@Composable
fun HomeCourseCard(
    lesson: HomeLessonUi,
    zone: ZoneId,
    subjectPrefs: List<SubjectPrefs>,
    modifier: Modifier = Modifier,
    countdown: String = "",
) {
    val style = subjectStyle(subjectPrefs, lesson.subject)
    // #137 : `subjectColorHex` ne rend plus jamais « pas de couleur » (prefs
    // d'abord, sinon une couleur dérivée du nom sur la palette du thème), donc
    // la carte de cours de l'accueil porte la MÊME couleur que celle de l'EDT.
    val hex = subjectColorHex(subjectPrefs, lesson.subject)
    val background = subjectSurface(hex) ?: MaterialTheme.colorScheme.surfaceVariant
    val ink = subjectContent(hex) ?: MaterialTheme.colorScheme.onSurface
    PapCard(modifier = modifier, containerColor = background, border = null) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(HOME_ACTION_GAP),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = style.badge,
                    style = MaterialTheme.typography.titleSmall,
                    color = ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (lesson.room.isNotEmpty()) {
                    Text(
                        text = lesson.room,
                        style = MaterialTheme.typography.bodySmall,
                        color = ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = homeRangeLabel(lesson.startMillis, lesson.endMillis, zone),
                    style = MaterialTheme.typography.titleSmall,
                    color = ink,
                    maxLines = 1,
                )
                if (countdown.isNotEmpty()) {
                    Text(
                        text = countdown,
                        style = MaterialTheme.typography.labelSmall,
                        color = ink,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/**
 * Grille 2×2 des accès rapides.
 *
 * Une ligne impaire (quatre accès : jamais, la grille est pleine) garderait des
 * cartes de largeurs différentes ; le remplissage sert aux listes plus courtes,
 * sans coût et sans cas particulier dans le code de chaque carte.
 */
@Composable
fun HomeQuickActionsGrid(
    actions: List<HomeQuickActionUi>,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (actions.isEmpty()) return
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (row in actions.chunked(2)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                for (action in row) {
                    HomeQuickActionCard(
                        action = action,
                        onClick = { onOpen(action.route) },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (row.size == 1) Box(modifier = Modifier.weight(1f))
            }
        }
    }
}

/**
 * Carte d'accès rapide : pastille colorée, titre en gras, UNE ligne d'état.
 *
 * La couleur vient de `HomeQuickActionUi.colorHex` (entrée de `SubjectPalette`)
 * via les deux fonctions de matière du thème : fond de pastille à 75 % vers le
 * blanc (sombre : 60 % vers le noir), encre mesurée à −45 % / +55 % (4.5:1 au
 * pire de la palette dans les deux thèmes). Le fond reste `surface` : le pastel
 * est déjà dans la pastille, la carte entière ne ferait que doubler.
 *
 * L'état est borné à une ligne (`homeEllipsis` côté logique) : une carte de
 * grille ne peut pas faire taller ses voisines.
 */
@Composable
fun HomeQuickActionCard(
    action: HomeQuickActionUi,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pastel = subjectSurface(action.colorHex) ?: MaterialTheme.colorScheme.secondaryContainer
    val ink = subjectContent(action.colorHex) ?: MaterialTheme.colorScheme.onSurface
    PapCard(
        modifier = modifier,
        onClick = onClick,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(HOME_ACTION_GAP),
        ) {
            Box(
                modifier = Modifier
                    .size(HOME_ACTION_ICON)
                    .clip(MaterialTheme.shapes.large)
                    .background(pastel),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = homeActionIcon(action.route),
                    contentDescription = null,
                    tint = ink,
                    modifier = Modifier.size(HOME_ACTION_GLYPH),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = action.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = action.status,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Icône d'un accès rapide : une entrée du CORE par route.
 *
 * Route inconnue = `Info` (fonction totale, comme `tabIcon`) : une exception sur
 * une chaîne ne vaut pas mieux qu'un glyphe neutre.
 */
private fun homeActionIcon(route: String): ImageVector = when (route) {
    ROUTE_NEWS -> Icons.Filled.Notifications
    ROUTE_CANTEEN -> Icons.Filled.Menu
    ROUTE_ATTENDANCE -> Icons.Filled.Warning
    ROUTE_MESSAGES -> Icons.Filled.MailOutline
    else -> Icons.Filled.Info
}
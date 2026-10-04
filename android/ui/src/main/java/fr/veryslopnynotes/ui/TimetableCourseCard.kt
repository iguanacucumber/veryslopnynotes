package fr.veryslopnynotes.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.ZoneId

// CARTE DE COURS #137 — la pièce qui manquait à l'EDT.
//
// AVANT, l'onglet EDT rendait une chaîne par cours : « Maths-Fake • Salle A12
// • Mme X • 08:00-09:00 », tout en encre de matière sur fond blanc. La couleur
// des `SubjectPrefs` ne fournissait qu'une teinte de texte (et, pour un cours
// annulé, un `Color.LightGray` à 1.5:1 — cf. #134). Une carte n'est pas une
// chaîne : c'est une PASTELLE de matière, une colonne vertébrale de la couleur
// franche à gauche, un nom de matière en gras, et une ligne de méta qui se lit
// d'un coup d'œil — c'est la forme de papillon.bzh, relevée sur l'app.
//
// Les couleurs ne sont pas des hex posés ici : le fond vient de
// `subjectSurface` (le pastel de matière), l'encre de `subjectContent` (le pas
// mesuré qui repasse 4.5:1 sur les 20 couleurs), la colonne de `colorFromHex`
// (la couleur de matière elle-même), et l'annulé du rôle `error` passé par le
// MÊME [tint] que tout le reste du thème. Aucune couleur en dur, donc le mode
// sombre est correct sans une seconde feuille de style.
//
// ponytail: `Restaurant` (la fourchette et le couteau) est dans
// `material-icons-extended`, et la liste des modules Gradle de `ui` est FIGÉE
// par un garde-fou : 10 000 icônes pour un glyphe, non. Le pictogramme est donc
// DESSINÉ (onze traits), ce qui le rend monochrome et teintable comme les
// `ImageVector` du thème. Upgrade: si le BOM avance et qu'`Icons.Filled.*`
// s'élargit, cette fonction devient une ligne — rien d'autre ne change.

/** Épaisseur de la colonne vertébrale : le seul élément NON pastel d'une carte.
 *  C'est elle qui rend la matière identifiable d'un coup d'œil, le fond pastel
 *  seul ne donnant qu'une teinte. */
private val SPINE_WIDTH = 6.dp

/** Gouttière de temps : 60 dp, comme sur l'app de référence. */
val TimetableTimeGutterWidth = 60.dp

/** Filet d'1 dp (bordure de carte, séparateur de méta). */
private val HAIRLINE = 1.dp

/** Bordure du cours mis en avant : 2 dp pour « en cours », 1 dp pour « suivant ». */
private val CURRENT_BORDER = 2.dp

/** Espacement interne d'une carte (plus serré que les 16 dp des briques #136 :
 *  une carte de cours tient en trois lignes, pas en cinq). */
private val CARD_PADDING_H = 12.dp
private val CARD_PADDING_V = 10.dp

/** Écart entre deux cartes : 8 dp, l'espacement de la liste de papillon.bzh. */
val TimetableCardGap = 8.dp

/** Côte et épaisseur d'un pictogramme dessiné. */
private val CUTLERY_SIZE = 18.dp

/** Unités du carré de dessin du pictogramme (20 × 20). */
private const val CUTLERY_UNITS = 20f

/** En dessous de cette luminance de surface, l'écran est en thème SOMBRE : les
 *  aplats clairs (un cours annulé, rouge pâle) y brûlent la lecture. */
private const val DARK_SURFACE_LUMINANCE = 0.5f

/** Opacité du séparateur vertical de la ligne de méta. */
private const val META_DIVIDER_ALPHA = 0.24f

/** Côte d'une icône de méta (14 dp : glyphe, pas bouton). */
private val META_ICON = 14.dp

private const val CANCELLED_LABEL = "Annulé"
private const val CURRENT_LABEL = "En cours"
private const val NEXT_LABEL = "Prochain"

/**
 * Fond d'un cours annulé : le rouge de marqueclairci à 82 % — c'est le
 * « rouge pâle » de l'app de référence, et non un hex recopié — et le MÊME rouge
 * assombri à −60 % quand la surface est sombre.
 *
 * Un aplat rouge pâle sur fond blanc mesure 1.5:1 avec le rouge du thème en
 * texte : c'est pour ça que l'encre d'un cours annulé n'est PAS `error` mais
 * [cancelledInk]. Cf. le miroir `tests/unit/android-timetable.test.ts`.
 */
fun cancelledSurface(error: Color, dark: Boolean): Color = tint(error, if (dark) -.60f else .82f)

/**
 * Encre d'un cours annulé : le rouge de la marque poussé dans la même direction
 * que l'encre d'une carte matière (`tint` à −45 %, le pas mesuré qui repasse
 * 4.5:1 sur toute la palette) en thème clair, éclairci à 72 % en thème sombre.
 *
 * Mesuré sur le fond [cancelledSurface] : 7.3:1 en clair, 8.9:1 en sombre.
 */
fun cancelledInk(error: Color, dark: Boolean): Color = tint(error, if (dark) .72f else -.45f)

/** L'écran est-il en thème sombre ? Le fond DU THÈME en décide — pas d'un
 *  réglage lu ailleurs, donc pas de désynchronisation possible. */
@Composable
fun isDarkSurface(): Boolean =
    relativeLuminance(MaterialTheme.colorScheme.surface) < DARK_SURFACE_LUMINANCE

/**
 * Carte d'un cours : gouttière de temps puis carte de matière.
 *
 * [label] est le libellé résolu par `SubjectStyle` (nom de matière ou libellé
 * perso, emoji compris), [colorHex] la couleur de matière (`#RRGGBB`, déjà
 * validée : venue des `SubjectPrefs` ou de la palette du thème). Les deux sont
 * calculées par l'écran — cette carte ne lit ni prefs ni dépôt.
 *
 * [highlight] encadre le cours en cours (2 dp) et signale le suivant (1 dp) :
 * c'est le seul état que la carte ajoute au statut du cours (annulé, déplacé),
 * qui se lit sur le texte.
 *
 * #145 : le cours EN COURS pulse en plus (échelle 1 -> 1.02, opacité qui descend
 * juste assez pour lire un battement). Le filet de 2 dp disait QUEL cours, jamais
 * CE MOMENT-LÀ — or c'est la question que l'onglet EDT sert. La pulsation est
 * coupée avec le reste quand le téléphone a désactivé les animations.
 */
@Composable
fun PapCourseCard(
    lesson: TimetableLessonUi,
    label: String,
    colorHex: String,
    zone: ZoneId,
    modifier: Modifier = Modifier,
    highlight: CourseHighlight = CourseHighlight.NONE,
) {
    val dark = isDarkSurface()
    val error = MaterialTheme.colorScheme.error
    val cancelled = lesson.isCancelled()
    // Repli `?: MaterialTheme…` : une couleur illisible ne doit pas laisser une
    // carte TRANSPARENTE (on ne verrait plus que le texte).
    val background = if (cancelled) {
        cancelledSurface(error, dark)
    } else {
        subjectSurface(colorHex) ?: MaterialTheme.colorScheme.surfaceVariant
    }
    val ink = if (cancelled) {
        cancelledInk(error, dark)
    } else {
        subjectContent(colorHex) ?: MaterialTheme.colorScheme.onSurface
    }
    val spine = if (cancelled) error else colorFromHex(colorHex) ?: MaterialTheme.colorScheme.primary
    Card(
        modifier = modifier.papCurrentPulse(highlight == CourseHighlight.CURRENT),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = background),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = when (highlight) {
            CourseHighlight.CURRENT -> BorderStroke(CURRENT_BORDER, spine)
            CourseHighlight.NEXT -> BorderStroke(HAIRLINE, spine)
            CourseHighlight.NONE -> null
        },
    ) {
        // `IntrinsicSize.Min` : la colonne vertébrale doit porter TOUTE la hauteur
        // de la carte, donc la Row se mesure à la hauteur de son plus haut enfant.
        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Box(modifier = Modifier.width(SPINE_WIDTH).fillMaxHeight().background(spine))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = CARD_PADDING_H, vertical = CARD_PADDING_V),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.titleMedium,
                        color = ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textDecoration = if (cancelled) TextDecoration.LineThrough else null,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    when {
                        cancelled -> PapPill(CANCELLED_LABEL, error)
                        highlight == CourseHighlight.CURRENT -> PapPill(CURRENT_LABEL, spine)
                        highlight == CourseHighlight.NEXT -> PapPill(NEXT_LABEL, spine)
                    }
                }
                val room = lesson.room?.takeIf { it.isNotEmpty() }
                val teacher = lesson.teacher?.takeIf { it.isNotEmpty() }
                if (room != null || teacher != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (room != null) PapMetaChip(Icons.Filled.Place, room, ink)
                        if (room != null && teacher != null) {
                            VerticalDivider(
                                modifier = Modifier.height(12.dp),
                                thickness = HAIRLINE,
                                color = ink.copy(alpha = META_DIVIDER_ALPHA),
                            )
                        }
                        if (teacher != null) PapMetaChip(Icons.Filled.Person, teacher, ink)
                    }
                }
                val duration = lessonDurationLabel(lesson)
                val moved = movedHintLabel(lesson, zone)
                if (duration.isNotEmpty() || moved != null) {
                    Text(
                        text = listOfNotNull(duration, moved).joinToString(" · "),
                        style = MaterialTheme.typography.labelMedium,
                        color = ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/**
 * Pause méridienne : une PASTILLE BLANCHE à part, jamais teintée — une pause
 * n'appartient à aucune matière, donc lui prêter celle d'un cours mentirait.
 *
 * Elle n'est pas dans le payload (le contrat `/v1/timetable` ne publie que des
 * cours) : elle est DÉDUITE du creux qui contient 12 h 30, cf.
 * [lunchBreakOf]. Blanc = rôle `surface` du thème, filet 1 dp pour rester
 * visible sur le fond blanc ; durée alignée à droite.
 */
@Composable
fun PapLunchCard(label: String, duration: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outline),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = CARD_PADDING_H, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            PapCutleryIcon(tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                text = label,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (duration.isNotEmpty()) {
                Text(
                    text = duration,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Gouttière de temps : début en gras, fin en encre secondaire, tous deux
 * centrés dans [TimetableTimeGutterWidth].
 *
 * L'heure affichée est TOUJOURS celle de la zone d'affichage (`lessonTimeLabel`
 * formate dans la zone passée), jamais l'heure brute du serveur : à 23 h de
 * décalage, ce sont les deux heures qui divergent, pas le jour.
 */
@Composable
fun PapLessonTimeGutter(lesson: TimetableLessonUi, zone: ZoneId, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.width(TimetableTimeGutterWidth),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = lessonTimeLabel(lesson.startMillis, zone),
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
        )
        Text(
            text = lessonTimeLabel(lesson.endMillis, zone),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

/** Icône + texte d'une ligne de méta, dans l'encre de la matière. */
@Composable
private fun PapMetaChip(icon: ImageVector, text: String, tint: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // Décorative : c'est le TEXTE (salle, professeur) qui porte le sens.
        Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = Modifier.size(META_ICON))
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Fourchette et couteau DESSINÉS (cf. l'en-tête du fichier : `Restaurant` est
 * hors `material-icons-core`, et la liste des modules Gradle est figée).
 * Monochrome et teintable : un glyphe emoji multicolore ne suit pas le thème.
 */
@Composable
private fun PapCutleryIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(CUTLERY_SIZE)) {
        val u = size.minDimension / CUTLERY_UNITS
        val w = u * 1.5f
        // Fourchette : trois dents, une traverse, un manche.
        drawLine(tint, Offset(3f * u, 2.5f * u), Offset(3f * u, 7.5f * u), w)
        drawLine(tint, Offset(4.7f * u, 2.5f * u), Offset(4.7f * u, 7.5f * u), w)
        drawLine(tint, Offset(6.4f * u, 2.5f * u), Offset(6.4f * u, 7.5f * u), w)
        drawLine(tint, Offset(3f * u, 7.5f * u), Offset(6.4f * u, 7.5f * u), w)
        drawLine(tint, Offset(4.7f * u, 7.5f * u), Offset(4.7f * u, 17.5f * u), w)
        // Couteau : lame (triangle) puis manche.
        drawPath(
            path = Path().apply {
                moveTo(10.2f * u, 2.5f * u)
                lineTo(12.4f * u, 2.5f * u)
                lineTo(11.3f * u, 10f * u)
                close()
            },
            color = tint,
        )
        drawLine(tint, Offset(11.3f * u, 9.5f * u), Offset(11.3f * u, 17.5f * u), w * 0.9f)
    }
}
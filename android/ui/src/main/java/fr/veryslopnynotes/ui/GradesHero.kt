package fr.veryslopnynotes.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

// Carte « moyenne générale » de l'onglet Notes #139, à la lettre de Papillon :
// une SPARKLINE verte de l'historique avec son point plein à droite, le grand
// nombre en gras vert, le titre de l'algorithme (`Moyenne des matières ⌄`) puis
// la provenance en petit gris (« par l'établissement » / « estimée au … »).
//
// Le tracé est un `Canvas` de Compose : ZÉRO bibliothèque de graphiques (le
// module `ui` n'a aucune ligne de dépendance ajoutée, cf. `build.gradle.kts`).
// La géométrie est une fonction PURE (`sparklinePoints` dans `Averages.kt`),
// donc elle se teste sans téléphone — son miroir est dans
// `tests/unit/android-averages.test.ts`.

/** Hauteur de la courbe : assez haute pour lire la pente, basse pour la carte. */
private val SPARK_HEIGHT = 48.dp

/** Épaisseur du trait, en dp. */
private val SPARK_WIDTH = 2.dp

/** Rayon du point plein de bout de courbe, en dp (la « bille » de Papillon). */
private val SPARK_DOT = 4.dp

/** Marge entre le trait et le bord de la carte, en dp : le point ne doit pas
 *  être rogné, donc la zone peinte est rétrécie d'autant. */
private val SPARK_MARGIN = 4.dp

/**
 * Sparkline : polyligne des moyennes successives + point plein au dernier point.
 *
 * Un point sans valeur est ignoré, et une série de moins de deux valeurs ne
 * trace AUCUNE ligne (une note unique n'est pas une tendance) : les règles sont
 * dans [sparklinePoints] et [hasSparkline], ici on ne fait que peindre. Sans
 * historique, le `Canvas` reste vide et l'écart se lit sous la carte
 * ([GradesHistoryNote]) — jamais une courbe qui inventerait un départ.
 *
 * La courbe est DÉCORATIVE : elle est annoncée une fois par
 * [sparklineDescription] (« Évolution de la moyenne : de 12,00 à 14,87. »),
 * donc un lecteur d'écran n'a jamais droit à une boîte vide.
 */
@Composable
fun AverageSparkline(
    values: List<Double?>,
    modifier: Modifier = Modifier,
    color: Color = PapillonGreen,
) {
    val description = remember(values) { sparklineDescription(values) }
    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(SPARK_HEIGHT)
            .clearAndSetSemantics { contentDescription = description },
    ) {
        val dot = SPARK_DOT.toPx()
        val margin = SPARK_MARGIN.toPx()
        val inner = Offset(margin, margin)
        val points = sparklinePoints(
            values = values,
            width = (size.width - 2 * margin).coerceAtLeast(0f),
            height = (size.height - 2 * margin).coerceAtLeast(0f),
        )
        if (points.isEmpty()) return@Canvas
        val at = { p: SparkPoint -> Offset(inner.x + p.x, inner.y + p.y) }
        if (points.size == 1) {
            drawCircle(color = color, radius = dot, center = at(points.first()))
            return@Canvas
        }
        val path = Path()
        path.moveTo(points.first().x + inner.x, points.first().y + inner.y)
        for (i in 1 until points.size) path.lineTo(points[i].x + inner.x, points[i].y + inner.y)
        drawPath(path = path, color = color, style = Stroke(width = SPARK_WIDTH.toPx(), cap = StrokeCap.Round))
        val last = at(points.last())
        drawCircle(color = color, radius = dot, center = last)
    }
}

/**
 * Carte héro : la moyenne générale de la période choisie.
 *
 * [report] `null` = cache sans rapport de moyennes (ancien payload,
 * établissement sans moyennes) : le titre et la provenance disparaissent, la
 * carte montre l'absence de chiffre — jamais un 0 substitué.
 *
 * [onAlgorithmClick] non nul = le chevron du titre ouvre le sélecteur
 * d'algorithme (comme chez Papillon, où le titre de la moyenne est le point
 * d'entrée du choix). La provenance affichée est TOUJOURS celle du contrat :
 * « par l'établissement » si l'établissement publie la moyenne, sinon la date
 * du dernier point d'historique, c'est-à-dire le jour du dernier calcul.
 */
@Composable
fun GradesAverageHero(
    report: AveragesUi?,
    modifier: Modifier = Modifier,
    onAlgorithmClick: (() -> Unit)? = null,
) {
    val general = remember(report) { generalAverageOf(report) }
    val spoken = remember(general) { averageLabel(general) }
    val lastHistory = report?.history?.lastOrNull()?.millis
    val title = if (report == null) "Moyenne générale" else algorithmLabel(report.algorithm)
    PapCard(modifier = modifier.fillMaxWidth()) {
        // 8 dp : les quatre blocs de la carte (courbe, moyenne, titre, origine)
        // sont un GROUPE — 6 dp les faisait se lire comme un seul bloc de texte.
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AverageSparkline(values = report?.history?.map { it.value } ?: emptyList())
            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (general == null) {
                    Text(
                        text = "Aucune moyenne sur cette période",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                } else {
                    Text(
                        text = formatMark(general.value),
                        style = MaterialTheme.typography.displaySmall,
                        // `secondary` et non `primary` : 3.45:1 sur la surface
                        // variante de la carte, 4.93:1 avec `secondary` — même
                        // vert à l'œil, AA en texte dans les deux thèmes.
                        color = MaterialTheme.colorScheme.secondary,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        // La phrase complète (« 14,87/20 (moyenne estimée,
                        // algorithme subject) ») est lue ici une fois, plutôt que
                        // de laisser lire le nombre puis la provenance à part.
                        modifier = Modifier.clearAndSetSemantics { contentDescription = spoken },
                    )
                    // Barème de sortie du rapport : TOUJOURS /20
                    // (`server/domain/averages.ts`), petit et gris comme chez
                    // Papillon.
                    Text(
                        text = scaleSuffix(AVERAGE_SCALE),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = if (onAlgorithmClick == null) {
                    Modifier
                } else {
                    // #146 : le geste était un `Row.clickable` de la hauteur du
                    // texte (≈ 24 dp) et SANS rôle — un lecteur d'écran n'y
                    // voyait ni bouton ni taille d'appui. `Role.Button` +
                    // `heightIn(min = TouchTarget)` : la cible fait 48 dp et le
                    // chevron a son propre libellé d'action.
                    Modifier
                        .heightIn(min = TouchTarget)
                        .clickable(
                            onClickLabel = "Changer de calcul de moyenne",
                            role = Role.Button,
                            onClick = onAlgorithmClick,
                        )
                },
            ) {
                // `heading()` : c'est le TITRE de la carte (l'algorithme
                // retenu). Il est aussi le point d'entrée du choix quand le
                // chevron est là : titre + bouton, donc les deux rôles se
                // cumulent sur le même nœud, ce que TalkBack annonce dans
                // l'ordre (« titre », « bouton »).
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                if (onAlgorithmClick != null) {
                    Icon(
                        imageVector = Icons.Filled.KeyboardArrowDown,
                        contentDescription = "Changer de calcul de moyenne",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            if (report != null) {
                Text(
                    text = originLabel(report.provided, lastHistory),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Mention « pas d'historique » sous la carte héro : une seule note (ou aucune)
 * ne donne aucune courbe, et une bande vide sous la moyenne ferait croire à un
 * bug d'affichage. La phrase est VIDE dès que la courbe existe, donc l'écran ne
 * dit jamais « pas d'historique » en ayant une courbe sous les yeux.
 */
@Composable
fun GradesHistoryNote(report: AveragesUi?, modifier: Modifier = Modifier) {
    val note = historyNote(report?.history?.map { it.value } ?: emptyList())
    if (note.isEmpty()) return
    Text(
        text = note,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}
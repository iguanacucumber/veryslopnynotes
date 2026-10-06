package fr.veryslopnynotes.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
//
// #192 : les VALEURS ci-dessous étaient choisies (48 dp de courbe, trait de
// 2 dp) ; elles sont désormais relevées dans `app/(tabs)/grades/atoms/
// Averages.tsx`. Le bloc graphique y fait 140 dp de haut et déborde de 16 dp
// sous lui (`marginBottom: -16`), la courbe vivant dans 24 dp de marge
// verticale et débordant de 4 dp à GAUCHE du bord de la carte
// (`horizontalPadding: 32` avec `marginLeft: -36`). On ne rejoue pas le débordement
// en CSS mais en géométrie : le trait part 4 dp AVANT le bord de carte et s'arrête
// 22 dp avant le bord droit, donc l'espace peint est asymétrique — c'est le geste
// qui donne à la courbe son air de débordement et pas de cadre.

/** Hauteur du BLOC graphique de la carte, marge verticale de la courbe comprise. */
private val SPARK_HEIGHT = 140.dp

/** Débordement du bloc graphique sous le corps de la carte (`marginBottom: -16`). */
private val SPARK_OVERLAP = 16.dp

/** Marge verticale de la courbe dans son bloc (`verticalPadding: 24`). */
private val SPARK_V_MARGIN = 24.dp

/**
 * Part du trait qui dépasse à GAUCHE du bord de la carte : 32 de marge interne
 * moins 36 de décalage vers la gauche, donc 4.
 */
private val SPARK_BLEED = 4.dp

/**
 * Espace nu entre la fin du trait et le bord DROIT de la carte, mesuré depuis le
 * bord du `Canvas` : 32 de marge interne, moins 10 de décalage vers la droite,
 * moins les 4 de débordement de gauche qui rapprochent le trait du bord — donc
 * 18. Le bloc est donc plus large que la carte des deux côtés, et le trait
 * n'est centré ni à gauche ni à droite.
 */
private val SPARK_TRAIL = 18.dp

/** Épaisseur du trait, en dp (`lineThickness: 4`). */
private val SPARK_WIDTH = 4.dp

/**
 * Rayon du point plein de bout de courbe, en dp.
 *
 * #192 : NON RELEVÉ. La référence passe par sa primitive `LineGraph`
 * (`enableIndicator`, `indicatorPulsating`) et n'y écrit aucun rayon — le point
 * est dessiné par la bibliothèque. On garde 4 dp : la valeur qui rend le point
 * lisible sur un trait de 4 dp. Upgrade: si un jour la primitive est relevée,
 * c'est cette ligne qu'il faut changer.
 */
private val SPARK_DOT = 4.dp

/** Espacement interne du corps de la carte (`padding: 18`, `paddingTop: 0`). */
private val HERO_BODY_PADDING = 18.dp

/** Écart entre les blocs du corps (`gap: 1`). */
private val HERO_BODY_GAP = 1.dp

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
            // Le trait déborde de 4 dp à gauche de la carte ; c'est la carte qui
            // borne (`overflow: "hidden"` côté référence), pas le `Canvas`.
            .offset(x = -SPARK_BLEED)
            .clearAndSetSemantics { contentDescription = description },
    ) {
        val dot = SPARK_DOT.toPx()
        val top = SPARK_V_MARGIN.toPx()
        val points = sparklinePoints(
            values = values,
            // Le bord droit se mesure depuis le bord du `Canvas`, pas depuis le
            // bord de la carte — d'où [SPARK_TRAIL] et non les 22 dp lus dans la
            // source. La différence est le débordement de gauche, qui fait
            // déborder le `Canvas` d'autant vers l'extérieur.
            width = (size.width - SPARK_TRAIL.toPx()).coerceAtLeast(0f),
            height = (size.height - 2 * top).coerceAtLeast(0f),
        )
        if (points.isEmpty()) return@Canvas
        val at = { p: SparkPoint -> Offset(p.x, top + p.y) }
        if (points.size == 1) {
            drawCircle(color = color, radius = dot, center = at(points.first()))
            return@Canvas
        }
        val path = Path()
        path.moveTo(points.first().x, top + points.first().y)
        for (i in 1 until points.size) path.lineTo(points[i].x, top + points[i].y)
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
    // #192 : rayon 24 et `overflow: hidden`. Le rayon vient du bloc graphique
    // (`borderRadius: 24`) ; le découpage vient de la même ligne, et il est
    // NÉCESSAIRE ici : le trait de la courbe déborde de 4 dp à gauche (cf.
    // [SPARK_BLEED]) et sans `clip` il sortirait de la carte.
    val shape = MaterialTheme.shapes.extraLarge
    Card(
        modifier = modifier.fillMaxWidth().clip(shape),
        shape = shape,
        // `item` côté référence, donc la surface variante du thème — mais SANS
        // bordure : la référence n'en pose pas sur cette carte, et notre
        // `PapCard` en pose une par défaut (`BorderStroke` sur `outline`).
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        // `elevation: 1` dans la source n'a d'effet qu'iOS et n'y dessine rien
        // (c'est la valeur par défaut d'une vue). On ne l'imite pas : une ombre
        // qui n'existe pas sur la plateforme visée serait un écart, pas une
        // fidélité.
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column {
            // Le bloc graphique occupe 140 dp − 16 dp de HAUTEUR DE FLUX : le
            // `Canvas` fait bien 140 dp et déborde donc sous le corps, comme le
            // `marginBottom: -16` de la référence. Il est encapsulé dans une
            // `Box` de 124 dp plutôt que décalé d'un `offset` : un décalage
            // laisserait 16 dp vides en bas de la carte, donc une carte trop
            // haute de 16 dp.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(SPARK_HEIGHT - SPARK_OVERLAP),
            ) {
                AverageSparkline(values = report?.history?.map { it.value } ?: emptyList())
            }
            Column(
                modifier = Modifier.padding(
                    start = HERO_BODY_PADDING,
                    end = HERO_BODY_PADDING,
                    // `paddingTop: 0` : la référence colle le grand nombre au
                    // débordement de la courbe. Un padding haut ici créationait
                    // une bande vide que la référence n'a pas.
                    top = 0.dp,
                    bottom = HERO_BODY_PADDING,
                ),
                // `gap: 1` : la référence colle les quatre blocs. AVANT, c'était
                // 8 dp — notre lecture, pas la sienne.
                verticalArrangement = Arrangement.spacedBy(HERO_BODY_GAP),
            ) {
                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
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
                            // `h1` de la référence sur Android : 34 sp gras. NOTRE
                            // `displayLarge` EST ce 34 (cf. `PapillonTypography`),
                            // où `displaySmall` = 24 (`h3`) — c'était ça l'écart :
                            // le nombre de la moyenne est le plus gros texte de
                            // l'écran et il tenait dans un `h3`.
                            style = MaterialTheme.typography.displayLarge,
                            // `secondary` et non `primary` : 3.45:1 sur la surface
                            // variante de la carte, 4.93:1 avec `secondary` — même
                            // vert à l'œil, AA en texte dans les deux thèmes.
                            //
                            // ÉCART ÉCRIT : la référence applique au vert de marque
                            // un pas de −20 % en clair (+20 % en sombre). On garde
                            // `secondary` : le même vert à l'œil, mais qui passe
                            // AA — le même arbitrage que `SUBJECT_CONTENT_*`
                            // (#189), donc la même décision et la même mesure.
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
                        // (`server/domain/averages.ts`). `body1` de la référence
                        // (15 sp), pas notre `bodyMedium` (14) — la référence
                        // n'a pas de corps à 14 sous son `h1`.
                        Text(
                            text = scaleSuffix(AVERAGE_SCALE),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(bottom = 2.dp),
                        )
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
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
                    //
                    // `title` de la référence : 18 sp SEMIBOLD. `titleLarge` est
                    // 18 sp GRAS chez nous, donc on retire le gras plutôt que de
                    // poser un nouveau style dans le thème : c'est la seule
                    // exception à la famille de la carte, elle est locale.
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { heading() },
                    )
                    if (onAlgorithmClick != null) {
                        Icon(
                            imageVector = Icons.Filled.KeyboardArrowDown,
                            contentDescription = "Changer de calcul de moyenne",
                            // `#192` : 16 dp à 50 % d'opacité. Un chevron de 20 dp
                            // plein se lisait comme un bouton à lui seul ; il ne
                            // l'est pas — c'est le TITRE qui est cliquable, et le
                            // chevron n'en est que l affordsance. `size = 16` et
                            // `opacity = 0.5` sont écrits dans la source.
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
                if (report != null) {
                    Text(
                        text = originLabel(report.provided, lastHistory),
                        // `body1` de la référence (15 sp) : sous un titre de 18, un
                        // corps à 13 se lisait comme une légende d'icône.
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
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
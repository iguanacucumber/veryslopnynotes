package fr.veryslopnynotes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

// Pastilles de note façon Papillon : contour clair (17/30) vs pleine (11/11).
// Dessin d'origine (aucune copie d'asset) : un stade [CircleShape], l'étoile
// Material déjà importée ailleurs, les pas de `PapillonTheme.kt`.

/**
 * Pastille pleine ssi la note ATTEINT son barème (11/11 dans la référence).
 *
 * `>=` et non `==` : un arrondi flottant qui dépasse d'un epsilon
 * (11,0000001/11) reste un sans-faute, et une note au-dessus du barème
 * (bonus) aussi. Barème illisible (`<= 0`, `NaN`) ou note `NaN` = jamais
 * pleine : rien d'inventé.
 */
fun isGradeFullMark(value: Double, scale: Double): Boolean =
    scale > 0 && !value.isNaN() && !scale.isNaN() && value >= scale

/**
 * La note en pastille : grand nombre + petit barème RÉEL — jamais un « /20 » inventé pour une évaluation notée sur une
 * autre échelle.
 *
 * Contour = fond pastel façon [PapPill] + encre matière ; pleine = fond encre
 * matière + encre MESURÉE ([bestContentOn], jamais du blanc en dur : blanc sur
 * jaune tombe à ~1,1:1) + étoile décorative. Tailles, ellipsis et lecture
 * TalkBack inchangées : les deux `Text` sont ceux d'avant, l'étoile est
 * décorative (`contentDescription = null`).
 *
 * [valueStyle] garde la taille du site d'appel (`displaySmall` 24 sur une
 * carte du carrousel, `headlineMedium` 21 sur une ligne de pile).
 */
@Composable
fun GradePill(
    grade: GradeUi,
    colorHex: String?,
    ink: Color,
    valueStyle: TextStyle,
    modifier: Modifier = Modifier,
) {
    val filled = isGradeFullMark(grade.value, grade.scale)
    val dark = isDarkSurface()
    // Contour : le pastel de la pastille (75 % vers le blanc en clair, 60 %
    // vers le noir en sombre) ; sans couleur de matière, la surface variante.
    val outlineBg = colorHex?.let { tint(it, if (dark) SUBJECT_SURFACE_DARK_TINT else SUBJECT_SURFACE_TINT) }
        ?: MaterialTheme.colorScheme.surfaceVariant
    // Pleine : l'encre CLAIRE de la matière (pas -15 % adouci), dans les DEUX
    // thèmes. L'encre sombre (+55 % vers le blanc) est un rose saumon qui
    // décolore la pastille ; l'encre claire garde le rouge profond de la
    // référence, et le blanc (ou l'encre mesurée) y reste lisible.
    val filledBg = colorHex?.let { subjectContent(it, false) } ?: ink
    val background = if (filled) filledBg else outlineBg
    val content = if (filled) bestContentOn(filledBg) else ink
    Box(
        modifier = modifier
            .clip(CircleShape)
            // Marges resserrées autour du texte (10/4) : posées, pas relevées.
            .background(background)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (filled) {
                Icon(
                    imageVector = Icons.Filled.Star,
                    contentDescription = null,
                    tint = content,
                    // 14 : lisible à côté d'un nombre en 21/24 sans l'écraser.
                    modifier = Modifier.size(14.dp),
                )
            }
            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = gradeValueLabel(grade.value),
                    style = valueStyle,
                    color = content,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = scaleSuffix(grade.scale),
                    style = MaterialTheme.typography.bodyLarge,
                    // Pleine : le gris de variante serait illisible sur l'encre,
                    // donc le barème prend l'encre mesurée comme le nombre.
                    color = if (filled) content else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }
        }
    }
}

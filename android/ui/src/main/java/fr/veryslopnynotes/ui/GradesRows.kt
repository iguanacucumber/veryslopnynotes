package fr.veryslopnynotes.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SubjectPrefs

// Sélecteurs et lignes de l'onglet Notes #139 : recherche, période, algorithme,
// carrousel « Nouvelles notes », sections par matière et lignes de note avec
// leur CONTEXTE DE CLASSE (moyenne, min, max, coefficient, bonus, facultatif,
// enseignant, commentaire) et l'INFLUENCE de la note sur la moyenne.
//
// Toute couleur vient de `PapillonTheme.kt` : la couleur de matière passe par
// `subjectStyle` (libellé/emoji/color des préférences matière) puis par
// `subjectContent` (−45 %, le seul pas qui repasse 4.5:1 sur les 20 couleurs).
// Aucune couleur en dur, aucune chaîne en dur venue du serveur.

/** Largeur d'une carte du carrousel : la carte doit tenir nom + note + date. */
private val RECENT_CARD_WIDTH = 190.dp

/** Couleur du texte de note quand la matière n'a pas de couleur choisie : le vert
 *  de marque, donc le même rôle que [subjectContent] côté palette. */
@Composable
private fun subjectInk(hex: String?): Color =
    (hex?.let { subjectContent(it) }) ?: MaterialTheme.colorScheme.primary

/** Fond pastel de la carte matière ([subjectSurface] : 75 % vers le blanc), ou la
 *  surface variant du thème quand la matière n'a pas de couleur choisie. */
@Composable
private fun subjectCardColor(hex: String?): Color =
    (hex?.let { subjectSurface(it) }) ?: MaterialTheme.colorScheme.surfaceVariant

/**
 * Champ de recherche : matière, libellé d'évaluation, enseignant. Le texte
 * saisi n'est JAMAIS envoyé au serveur — c'est un filtre local sur le payload
 * déjà reçu (donnée déjà présente, pas une nouvelle entrée).
 */
@Composable
fun GradesSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    TextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text("Matière ou évaluation") },
        leadingIcon = { Icon(imageVector = Icons.Filled.Search, contentDescription = null) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(imageVector = Icons.Filled.Close, contentDescription = "Effacer la recherche")
                }
            }
        },
        singleLine = true,
        shape = MaterialTheme.shapes.large,
        colors = TextFieldDefaults.colors(
            // Champ sans filet : la forme arrondie du thème fait le contour, comme
            // les cartes de Papillon. Aucune couleur en dur.
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
            focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    )
}

/** Chips d'algorithme : les trois du contrat, celui du rapport mis en avant. */
@Composable
fun GradesAlgorithmChips(
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    GradesChipRow(modifier = modifier) {
        for (algorithm in AVERAGE_ALGORITHM_CHOICES) {
            FilterChip(
                selected = algorithm == selected,
                onClick = { onSelect(algorithm) },
                label = { Text(algorithmChipLabel(algorithm)) },
            )
        }
    }
}

/**
 * Chips de période : « Année » (aucun `periodId`) puis les tranches publiées par
 * `/v1/periods`. Changer de chip change la QUERY envoyée à `/v1/grades`, donc le
 * serveur recalcule moyennes, historique et influences.
 */
@Composable
fun GradesPeriodChips(
    periods: List<PeriodUi>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (periods.isEmpty()) return
    GradesChipRow(modifier = modifier) {
        FilterChip(
            selected = selectedId == null,
            onClick = { onSelect(null) },
            label = { Text("Année") },
        )
        for (period in periods) {
            FilterChip(
                selected = period.id == selectedId,
                onClick = { onSelect(period.id) },
                label = { Text(period.name) },
            )
        }
    }
}

/** Ligne de chips défilante : une rangée par ligne, sans jamais tronquer un choix. */
@Composable
private fun GradesChipRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        content()
    }
}

/** Étendue de la période choisie, en toutes lettres (« Trimestre 1 · 01/09/2026 – … »). */
@Composable
fun GradesPeriodCaption(
    periods: List<PeriodUi>,
    selectedId: String?,
    modifier: Modifier = Modifier,
) {
    val period = periods.firstOrNull { it.id == selectedId } ?: return
    Text(
        text = periodLabel(period),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/**
 * Carrousel « Nouvelles notes » : les dernières notes, une carte par note.
 *
 * Chaque carte porte ce que Papillon y met : pastille matière, nom de la matière
 * dans sa couleur, nom de l'ÉVALUATION en gras dans sa couleur, date relative et
 * note en grand dans sa couleur. Une évaluation SANS libellé publié n'affiche
 * pas de ligne de titre (le nom de la matière est déjà juste au-dessus, et le
 * répéter n'apporte rien).
 */
@Composable
fun GradesRecentCarousel(
    grades: List<GradeUi>,
    prefs: List<SubjectPrefs>,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    if (grades.isEmpty()) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        for (grade in grades) {
            val style = subjectStyle(prefs, grade.subject)
            val ink = subjectInk(style.colorHex)
            PapCard(
                modifier = Modifier.width(RECENT_CARD_WIDTH),
                containerColor = subjectCardColor(style.colorHex),
                onClick = null,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    PapSubjectAvatar(emoji = style.emoji, color = ink)
                    Text(
                        text = style.label,
                        style = MaterialTheme.typography.labelMedium,
                        color = ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = grade.label.orEmpty(),
                        style = MaterialTheme.typography.titleSmall,
                        color = ink,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = relativeTimeFr(grade.millis, nowMillis),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    GradeValue(grade = grade, ink = ink)
                }
            }
        }
    }
}

/**
 * Sections par matière : emoji + nom en gras, moyenne à droite en gris, puis
 * les lignes de note sur une carte claire.
 */
@Composable
fun GradesSubjectSections(
    groups: List<GradeGroupUi>,
    prefs: List<SubjectPrefs>,
    influences: List<InfluenceUi>,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    for (group in groups) {
        val style = subjectStyle(prefs, group.subject)
        Column(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!style.emoji.isNullOrEmpty()) {
                    Text(text = style.emoji, style = MaterialTheme.typography.titleMedium)
                }
                Text(
                    text = style.label,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(
                    text = subjectAverageLabel(group),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            for (grade in group.grades) {
                GradeRow(
                    grade = grade,
                    prefs = prefs,
                    influence = influenceOf(influences, grade.id),
                    nowMillis = nowMillis,
                )
            }
        }
    }
}

/** Moyenne de la matière à droite du titre : valeur + « n notes ». */
private fun subjectAverageLabel(group: GradeGroupUi): String {
    val value = group.average
    val notes = group.grades.size
    val count = if (notes <= 1) "1 note" else "$notes notes"
    return if (value == null) "$count" else "${formatMark(value)} · $count"
}

/**
 * Ligne de note : évaluation en gras, date relative, note en gras à droite avec
 * son barème, puis le CONTEXTE et l'INFLUENCE.
 *
 * Le contrat ne porte QU'UN texte libre par note, `label` (« libellé libre de
 * l'évaluation (commentaire enseignant) ») : il est affiché UNE seule fois, en
 * gras comme titre de la ligne. Le dupliquer en citation sous le titre
 * afficherait deux fois la même chaîne — donc le commentaire de l'enseignant,
 * quand il est là, EST le titre.
 *
 * [influence] `null` = l'établissement ne publie pas d'influence pour cette note :
 * aucune ligne n'est inventée.
 */
@Composable
fun GradeRow(
    grade: GradeUi,
    prefs: List<SubjectPrefs>,
    influence: InfluenceUi?,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    val style = subjectStyle(prefs, grade.subject)
    val ink = subjectInk(style.colorHex)
    PapCard(
        modifier = modifier.fillMaxWidth(),
        containerColor = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = gradeLabel(grade),
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = relativeTimeFr(grade.millis, nowMillis),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                GradeValue(grade = grade, ink = ink)
            }
            val context = gradeContextLabel(grade)
            if (context.isNotEmpty()) {
                Text(
                    text = context,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (influence != null) {
                Text(
                    text = influenceLabel(influence.impact),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (influence.impact > 0) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                )
            }
        }
    }
}

/**
 * La note : grand nombre dans la couleur de la matière, barème petit et gris.
 * Une note hors /20 affiche son BARÈME RÉEL (`/10`, `/15`) : jamais un « /20 »
 * inventé pour une évaluation notée sur une autre échelle.
 */
@Composable
private fun GradeValue(grade: GradeUi, ink: Color) {
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = gradeValueLabel(grade.value),
            style = MaterialTheme.typography.headlineMedium,
            color = ink,
        )
        Text(
            text = scaleSuffix(grade.scale),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 2.dp),
        )
    }
}

/**
 * Nom de l'évaluation : le libellé publié par l'enseignant quand il existe,
 * sinon le NOM DE LA MATIÈRE (jamais une chaîne vide, jamais un UUID).
 */
fun gradeLabel(grade: GradeUi): String {
    val label = grade.label?.trim().orEmpty()
    return if (label.isEmpty()) grade.subject else label
}
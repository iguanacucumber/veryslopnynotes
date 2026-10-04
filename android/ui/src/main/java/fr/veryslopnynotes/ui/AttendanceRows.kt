package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SubjectPrefs

// #141 : RENDU de l'écran « Vie scolaire », à la forme de Papillon relevée sur
// l'app qui tourne : carte de statut verte, sections « Absences » / « Retards »,
// une carte par événement.
//
// AVANT #141, la même page rendait des `Text` bruts et une seule ligne
// concaténée par événement (« Retard 2026-10-01 -> 2026-10-02 en Maths (45min)
// non justifiee »), sans filet ni couleur. Ici chaque donnée a sa place : le
// motif en titre, la date en français en sous-titre, la durée en gras à droite,
// le justificatif en pastille.
//
// Chaque couleur vient de `PapillonTheme.kt` : `primaryContainer` /
// `onPrimaryContainer` pour l'état « tout justifié » (les deux rôles que le
// thème pose pour un bandeau d'information), et `tertiary` passé par [tint] pour
// l'état « des heures injustifiées » — le thème ne pose AUCUN rôle
// « avertissement », et `tertiaryContainer` resterait au lavande Material par
// défaut. Le contraste des deux couples est MESURÉ par
// `tests/unit/android-attendance.test.ts` (AA).
//
// ponytail: aucune icône hors `material-icons-core` (déjà dans le graphe via
// material3, cf. `AppIcons.kt`) : `Clear` = cours manqué, `Warning` = retard,
// `CheckCircle` = rien à signaler.

/** Fond ambre, version claire (foncé en mode sombre). */
private const val WARNING_CONTAINER_TINT = 0.55f
/** Encre ambre du mode sombre ; en mode clair c'est l'inverse du fond. */
private const val WARNING_TEXT_TINT = 0.7f
/** Seuil de luminance sous lequel le thème est en mode sombre : la surface
 *  claire vaut 1.0, la surface sombre `#121212` vaut 0.006. */
private const val SURFACE_IS_DARK = 0.5f

/**
 * Encre de la matière sur sa carte, ou le vert de marque si la matière n'en a
 * pas — même repli que `GradesRows.kt`, donc pas de seconde règle.
 *
 * `subjectColorHex` (#139) renvoie TOUJOURS un `#RRGGBB` valide (les préférences
 * d'abord, sinon une couleur de la palette du thème), donc la branche d'échec
 * ci-dessous est celle que le compilateur exige, pas un cas vécu.
 */
@Composable
private fun eventSubjectInk(hex: String): Color =
    (subjectContent(hex)) ?: MaterialTheme.colorScheme.primary

/** Icône d'une section : `Clear` (barré = cours manqué) pour une absence,
 *  `Warning` pour un retard. Les deux sont dans `material-icons-core`. */
private fun sectionIcon(kind: String): ImageVector =
    if (kind == "late") Icons.Filled.Warning else Icons.Filled.Clear

/**
 * Carte de statut, en TÊTE de page : vert quand aucune heure n'est injustifiée,
 * ambre sinon, et le total des heures manquées dans la MÊME carte (une ligne
 * blanche « Heures manquées », valeur en gras à droite).
 *
 * [status] vient de `attendanceStatus` : la carte ne décide pas, elle rend.
 */
@Composable
fun AttendanceStatusCard(status: AttendanceStatusUi, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    // Fond et encre de l'état « à justifier ». Le couple est INVERSÉ en mode
    // sombre (fond foncé, encre claire) : `tertiary` est le vert clair de la
    // marque, donc le laisser tel quel poserait une carte criarde sur un fond
    // noir. Le mode se LIT dans le thème — `relativeLuminance(surface)` vaut 1.0
    // en clair et 0.006 sur la surface sombre — donc aucune couleur en dur et
    // aucun `isSystemInDarkTheme()` à câbler ici.
    val dark = relativeLuminance(scheme.surface) < SURFACE_IS_DARK
    val container = if (status.clean) {
        scheme.primaryContainer
    } else if (dark) {
        tint(scheme.tertiary, -WARNING_CONTAINER_TINT)
    } else {
        tint(scheme.tertiary, WARNING_CONTAINER_TINT)
    }
    val ink = if (status.clean) {
        scheme.onPrimaryContainer
    } else if (dark) {
        tint(scheme.tertiary, WARNING_TEXT_TINT)
    } else {
        tint(scheme.tertiary, -WARNING_CONTAINER_TINT)
    }
    PapCard(modifier = modifier.fillMaxWidth(), containerColor = container) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    imageVector = if (status.clean) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                    contentDescription = null,
                    tint = ink,
                    modifier = Modifier.size(24.dp),
                )
                // `titleMedium` = 16 sp GRAS : le verdict tient en un coup d'œil.
                Text(
                    text = status.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = ink,
                )
            }
            Text(
                text = status.detail,
                style = MaterialTheme.typography.bodyMedium,
                color = ink,
            )
            // Ligne blanche dans la carte : le total manque, il ne se fond pas
            // dans le pastel (papillon.bzh pose la même sous-carte).
            PapCard(
                modifier = Modifier.fillMaxWidth(),
                containerColor = scheme.surface,
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Heures manquées",
                        style = MaterialTheme.typography.bodyMedium,
                        color = scheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = durationLongFr(status.totalMinutes),
                        style = MaterialTheme.typography.titleSmall,
                        color = scheme.onSurface,
                    )
                }
            }
        }
    }
}

/**
 * En-tête de page : la TRANCHE choisie, son numéro en pastille, et un chevron qui
 * ouvre le sélecteur de période.
 *
 * Le sélecteur lui-même est [GradesPeriodChips] — la ligne DÉFILABLE déjà écrite
 * par #139 pour l'onglet Notes. Avant #141, la rangée de `FilterChip` de cet
 * écran n'avait aucun `horizontalScroll` : avec trimestres + semestres + année,
 * les derniers choix sortaient de l'écran et devenaient INATTEIGNABLES.
 *
 * [onRefresh] est le geste de relecture de l'écran : la barre du haut n'a pas de
 * slot `Refresh` pour cette route (#162), donc le bouton vit ici, à côté du
 * sélecteur — et le bandeau « périmé » en propose un second.
 */
@Composable
fun AttendanceHeader(
    periodName: String,
    periodNumber: String?,
    expanded: Boolean,
    onToggle: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (periodNumber != null) {
            PapPill(text = periodNumber, color = MaterialTheme.colorScheme.primary)
        }
        Text(
            text = periodName,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onToggle) {
            Icon(
                imageVector = if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                contentDescription = if (expanded) "Masquer les périodes" else "Choisir la période",
            )
        }
        IconButton(onClick = onRefresh) {
            Icon(imageVector = Icons.Filled.Refresh, contentDescription = "Actualiser")
        }
    }
}

/**
 * Carte d'un événement : motif en gras, date en français en gris, durée en gras à
 * droite, pastille de justificatif et matière dans sa couleur.
 *
 * L'absence INJUSTIFIÉE est signalée DEUX fois : la pastille rouge et la durée
 * en rouge. Un seul signal se perd (le rouge de la durée se lit comme une alerte
 * de saisie) ; deux, non — et le blanc de la carte ne change pas, donc la
 * comparaison entre deux cartes reste immédiate.
 *
 * Le motif est affiché TEL QUEL : c'est une donnée de l'établissement, jamais une
 * instruction (I6).
 */
@Composable
fun AttendanceEventCard(
    row: AbsenceUi,
    modifier: Modifier = Modifier,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    nowMillis: Long = System.currentTimeMillis(),
) {
    val scheme = MaterialTheme.colorScheme
    val unjustified = isUnjustified(row)
    val date = remember(row.date, row.dateEnd, nowMillis) { absenceDateSpan(row, nowMillis) }
    val subject = row.subject?.trim()?.takeIf { it.isNotEmpty() }
    PapCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = absenceTitle(row),
                        style = MaterialTheme.typography.titleSmall,
                        color = scheme.onSurface,
                    )
                    if (date.isNotEmpty()) {
                        Text(
                            text = date,
                            style = MaterialTheme.typography.bodySmall,
                            color = scheme.onSurfaceVariant,
                        )
                    }
                }
                val minutes = row.minutes
                if (minutes != null) {
                    Text(
                        text = minutesLabel(minutes),
                        style = MaterialTheme.typography.titleSmall,
                        color = if (unjustified) scheme.error else scheme.onSurface,
                    )
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PapPill(
                    text = justifiedBadge(row.justified),
                    color = if (unjustified) scheme.error else scheme.primary,
                )
                if (subject != null) {
                    // #139 : couleur de matière, prefs d'abord sinon dérivée du
                    // nom — donc la même colonne vertébrale que partout ailleurs.
                    val ink = eventSubjectInk(subjectColorHex(subjectPrefs, subject))
                    Text(
                        text = subject,
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
 * Une section « Absences » ou « Retards » : icône grise + titre + compteur, puis
 * une carte par événement.
 *
 * [sections] ne contient que les sections qui ont des lignes (`attendanceSections`),
 * donc une section vide n'est jamais rendue et le compteur n'est affiché
 * qu'UNE fois par type — les anciens compteurs étaient doublés (une ligne par
 * période, puis une ligne de totaux).
 */
@Composable
fun AttendanceSections(
    sections: List<AttendanceSectionUi>,
    modifier: Modifier = Modifier,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    nowMillis: Long = System.currentTimeMillis(),
) {
    for (section in sections) {
        Column(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            PapSectionHeader(
                icon = sectionIcon(section.kind),
                title = section.title,
                count = section.rows.size,
            )
            for (row in section.rows) {
                AttendanceEventCard(
                    row = row,
                    subjectPrefs = subjectPrefs,
                    nowMillis = nowMillis,
                )
            }
        }
    }
}

/**
 * Carte d'une sanction : la NATURE en titre (donnée du contrat), la date en
 * français, le niveau de gravité s'il est publié, et le motif déclaré en dessous.
 *
 * AVANT #141 : « 2026-10-02T10:00:00.000Z · Avertissement (gravité 1) », donc une
 * date ISO brute et un nombre nu sans signification. `gravityLabel` rend
 * « Niveau 1 » ; un établissement qui ne publie pas de gravité n'affiche aucune
 * étiquette plutôt qu'un « 0 » deviné.
 */
@Composable
fun PunishmentCard(
    row: PunishmentUi,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    val scheme = MaterialTheme.colorScheme
    val date = remember(row.date, nowMillis) { schoolDateLabel(row.date, nowMillis) }
    PapCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = row.type,
                style = MaterialTheme.typography.titleSmall,
                color = scheme.onSurface,
            )
            if (date.isNotEmpty()) {
                Text(
                    text = date,
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                )
            }
            val gravity = remember(row.gravity) { gravityLabel(row.gravity) }
            if (gravity != null) {
                PapPill(text = gravity, color = scheme.error)
            }
            // Donnée établissement ci-dessous : affichée telle quelle, jamais
            // exécutée (I6).
            Text(
                text = row.motif,
                style = MaterialTheme.typography.bodyMedium,
                color = scheme.onSurface,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
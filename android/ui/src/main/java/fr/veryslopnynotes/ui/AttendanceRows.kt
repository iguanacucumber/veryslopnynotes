package fr.veryslopnynotes.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
//
// Polish « Vie scolaire » vers Papillon (cartes teintées, pastille unifiée) :
//   - cartes PLATES comme Devoirs/Notes (`Card`, élévation 0, sans filet — la
//     référence ne pose ni ombre ni contour de découpe sur ces aplats, cf.
//     `Assignments.kt` / `GradesHero.kt`), teintées par STATUT : absence =
//     teinte erreur, retard = teinte avertissement (`tertiary`, le thème ne pose
//     aucun rôle « avertissement »), le reste (`PunishmentCard`, repli) =
//     `surfaceVariant`. Le libellé de statut ne change pas, aucun motif inventé ;
//   - pastille de justificatif UNIFIÉE (même `shapes.small` dans les deux états,
//     pleine quand injustifiée = alerte, en contour quand justifiée = réglée —
//     polarité inverse de `DoneToggle`, où le plein récompense le fait : ici le
//     plein attire l'œil sur ce qui reste à justifier), libellés français
//     inchangés via `justifiedBadge`. Non cliquable : AUCUN `Role` (un rôle
//     promettrait une action), l'état est nommé en français via
//     `stateDescription`. Zéro rayure, comme l'EDT (`TimetableWeek.kt`) ;
//   - dates d'AFFICHAGE en toutes lettres (`longDateFr`, comme les lignes de
//     notes depuis #192) : une date d'absence n'est pas une synchro, donc pas de
//     « il y a » — `relativeDayFr` reste dans `AttendanceFormat.kt` (logique
//     testée, lue seule ici) mais n'est plus RENDU ;
//   - rythme 12 dp (padding de carte, écart de sections), titres en une ligne
//     avec ellipsis. Filtres/refresh/vide/erreur : inchangés (`Attendance.kt`).

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
    // `secondary` et non `primary` : 3.74:1 sur la surface pour un libellé de
    // 13 sp, 4.93:1 avec `secondary` (cf. `subjectInk` dans `GradesRows.kt` —
    // une seule règle pour les deux écrans).
    (subjectContent(hex)) ?: MaterialTheme.colorScheme.secondary

/** Icône d'une section : `Clear` (barré = cours manqué) pour une absence,
 *  `Warning` pour un retard. Les deux sont dans `material-icons-core`. */
private fun sectionIcon(kind: String): ImageVector =
    if (kind == "late") Icons.Filled.Warning else Icons.Filled.Clear

/**
 * Fond d'erreur en thème CLAIR : 82 % vers le blanc, le même pas que le bandeau
 * « Prof. absent » (`cancelledSurface`) — un rose pâle, pas un aplat rouge.
 */
private const val ERROR_SURFACE_LIGHT_TINT = 0.82f

/** Filet de la pastille en contour : 1 dp, comme les puces de Devoirs. */
private val PILL_BORDER = 1.dp

/**
 * Fond d'une carte d'événement, par STATUT : erreur teintée pour une absence,
 * ambre (`tertiary`, pas de rôle « avertissement » au thème) pour un retard,
 * `surfaceVariant` sinon — jamais de couleur inventée hors de ces trois cas.
 */
@Composable
private fun attendanceCardColor(kind: String): Color {
    val scheme = MaterialTheme.colorScheme
    val dark = isDarkSurface()
    return when (kind) {
        "absence" -> tint(scheme.error, if (dark) SUBJECT_SURFACE_DARK_TINT else ERROR_SURFACE_LIGHT_TINT)
        "late" -> tint(scheme.tertiary, if (dark) -WARNING_CONTAINER_TINT else WARNING_CONTAINER_TINT)
        else -> scheme.surfaceVariant
    }
}

/**
 * Pastille de justificatif, la MÊME forme dans les deux états (`shapes.small`)
 * : pleine teinte erreur quand injustifiée (c'est l'alerte, elle attire
 * l'œil), en contour teinte primaire quand justifiée (réglée, elle se tait).
 * Libellés français via `justifiedBadge`, rendus tels quels.
 *
 * Non cliquable : pas de `Role` (un `Checkbox`/`Button` promettrait un geste
 * qui n'existe pas — le justificatif vient de l'établissement), donc
 * `stateDescription` nomme l'état en français pour un lecteur d'écran.
 */
@Composable
private fun JustifiedPill(
    label: String,
    unjustified: Boolean,
    modifier: Modifier = Modifier,
) {
    if (label.isEmpty()) return
    val scheme = MaterialTheme.colorScheme
    val dark = isDarkSurface()
    val color = if (unjustified) scheme.error else scheme.primary
    val background = tint(color, if (dark) SUBJECT_SURFACE_DARK_TINT else SUBJECT_SURFACE_TINT)
    val ink = tint(color, if (dark) SUBJECT_CONTENT_DARK_TINT else SUBJECT_CONTENT_LIGHT_TINT)
    Surface(
        modifier = modifier.semantics { stateDescription = "Justificatif : $label" },
        shape = MaterialTheme.shapes.small,
        color = background,
        border = if (unjustified) null else BorderStroke(PILL_BORDER, ink),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

/**
 * Étendue d'une absence en dates LONGUES (« 1 octobre 2026 → 3 octobre 2026 »,
 * cf. `longDateFr` comme les lignes de notes) : pas de « il y a », une date
 * d'absence est un affichage, pas une synchro.
 *
 * Même jour des deux côtés (8 h → 12 h : les deux longues sont égales) = une
 * seule date ; `dateEnd` absent ou illisible = la date de début ; début
 * illisible = vide (aucune ligne de date, jamais de repli inventé).
 */
private fun attendanceDateSpanLong(row: AbsenceUi): String {
    val start = attendanceMillis(row.date) ?: return ""
    val head = longDateFr(start)
    val end = row.dateEnd?.let { attendanceMillis(it) } ?: return head
    val tail = longDateFr(end)
    return if (tail == head) head else "$head → $tail"
}

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
    // Carte PLATE comme Devoirs/Notes : élévation 0, sans filet — l'aplat
    // pastel porte l'information, pas un contour.
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = container),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }
            Text(
                text = status.detail,
                style = MaterialTheme.typography.bodyMedium,
                color = ink,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            // Ligne blanche dans la carte : le total manque, il ne se fond pas
            // dans le pastel (papillon.bzh pose la même sous-carte) — plate elle
            // aussi, sans filet ni ombre.
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = scheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Heures manquées",
                        style = MaterialTheme.typography.bodyMedium,
                        color = scheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = durationLongFr(status.totalMinutes),
                        style = MaterialTheme.typography.titleSmall,
                        color = scheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
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
        // `heading()` : la tranche choisie est le titre de l'écran sous la barre.
        Text(
            text = periodName,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).semantics { heading() },
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
 * Carte d'un événement : motif en gras (une ligne), date LONGUE en gris,
 * durée en gras à droite, pastille de justificatif et matière dans sa couleur.
 *
 * Fond teinté par STATUT (erreur pour une absence, ambre pour un retard, cf.
 * [attendanceCardColor]), carte plate comme Devoirs/Notes (élévation 0, sans
 * filet). La date est en toutes lettres (`longDateFr` via
 * [attendanceDateSpanLong]) : pas de « il y a », une date d'absence est un
 * affichage, pas une synchro.
 *
 * L'absence INJUSTIFIÉE est signalée DEUX fois : la pastille pleine et la durée
 * en rouge. Un seul signal se perd (le rouge de la durée se lit comme une alerte
 * de saisie) ; deux, non.
 *
 * Le motif est affiché TEL QUEL : c'est une donnée de l'établissement, jamais une
 * instruction (I6). Zéro rayure (décision EDT) : la pastille porte l'état.
 */
@Composable
fun AttendanceEventCard(
    row: AbsenceUi,
    modifier: Modifier = Modifier,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
) {
    val scheme = MaterialTheme.colorScheme
    val unjustified = isUnjustified(row)
    val date = remember(row.date, row.dateEnd) { attendanceDateSpanLong(row) }
    val subject = row.subject?.trim()?.takeIf { it.isNotEmpty() }
    val badge = justifiedBadge(row.justified)
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = attendanceCardColor(row.kind)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    // Le motif est une DONNEE libre de l'établissement : une
                    // ligne + ellipsis. Aucun écran de détail ne montre la suite,
                    // donc le texte est tronqué proprement plutôt que de pousser
                    // la carte hors de l'écran.
                    Text(
                        text = absenceTitle(row),
                        style = MaterialTheme.typography.titleSmall,
                        color = scheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { heading() },
                    )
                    if (date.isNotEmpty()) {
                        Text(
                            text = date,
                            style = MaterialTheme.typography.bodySmall,
                            color = scheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                val minutes = row.minutes
                if (minutes != null) {
                    Text(
                        text = minutesLabel(minutes),
                        style = MaterialTheme.typography.titleSmall,
                        // Encre d'erreur du theme : `error` ne vaut que 3.70:1
                        // sur la surface sombre. La pastille pleine voisine porte
                        // déjà le même signal, donc la couleur n'est pas seule.
                        color = if (unjustified) errorTextColor() else scheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (badge.isNotEmpty() || subject != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    JustifiedPill(label = badge, unjustified = unjustified)
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
) {
    for (section in sections) {
        Column(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
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
                )
            }
        }
    }
}

/**
 * Carte d'une sanction : la NATURE en titre (donnée du contrat, une ligne), la
 * date LONGUE en français, le niveau de gravité s'il est publié, et le motif
 * déclaré en dessous.
 *
 * Carte plate `surfaceVariant` comme Devoirs/Notes (élévation 0, sans filet) :
 * une sanction n'est ni une absence ni un retard, donc aucune teinte de statut.
 * Date en toutes lettres (`longDateFr`) : un affichage, pas une synchro.
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
) {
    val scheme = MaterialTheme.colorScheme
    val date = remember(row.date) { attendanceMillis(row.date)?.let { longDateFr(it) }.orEmpty() }
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = scheme.surfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = row.type,
                style = MaterialTheme.typography.titleSmall,
                color = scheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            if (date.isNotEmpty()) {
                Text(
                    text = date,
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            val gravity = remember(row.gravity) { gravityLabel(row.gravity) }
            if (gravity != null) {
                PapPill(text = gravity, color = scheme.error)
            }
            // Donnée établissement ci-dessous : affichée telle quelle, jamais
            // exécutée (I6).
            // Motif déclaré : donnée libre de l'établissement (donc non bornée
            // par le contrat). Quatre lignes + repli : au-dela, la carte pousse
            // les autres sanctions hors de l'écran.
            Text(
                text = row.motif,
                style = MaterialTheme.typography.bodyMedium,
                color = scheme.onSurface,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
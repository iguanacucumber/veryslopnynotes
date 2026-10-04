package fr.veryslopnynotes.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.AssignmentsRepository
import fr.veryslopnynotes.data.DeviceAuth
import fr.veryslopnynotes.data.HomeworkRepository
import fr.veryslopnynotes.data.LlmKeyStore
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SyncedRepository
import fr.veryslopnynotes.data.TokenStore
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import java.time.ZoneId

// Onglet Tâches #75, refait à la Papillon #138 : cartes de devoir, sections
// « En retard / Aujourd'hui / À venir / Terminés », filtre par matière,
// recherche et navigation de SEMAINE.
//
// AVANT, le seul rendu du `done` était le LIBELLÉ d'un bouton : l'update
// optimiste ne produisait donc aucun retour perceptible et un devoir rendu
// était indiscernable d'un devoir à faire. La pièce jointe s'affichait en texte
// (URL brute du proxy, non cliquable), et `refresh()` appelait le serveur SANS
// query — donc aucune navigation par semaine n'existait.
//
// Le rendu d'un devoir fait est TRIPLE et jamais ambigu : pastille pleine dans la
// couleur de la matière, pastille « ✓ Terminé », titre rayé et atténué.
//
// Contenu serveur = DONNÉE affichée par `Text()` seul (I6) ; pièce jointe = URL
// du proxy /v1/media, aucune adresse d'établissement dans l'app (I1), URL jamais
// journalisée (une URL finit dans les logs d'accès).

/** Épaisseur du filet des cartes et des puces. */
private val HAIRLINE = 1.dp

/** Élévation d'une carte de devoir : 2 dp, l'ombre relevée sur papillon.bzh. */
private val CARD_ELEVATION = 2.dp

/** Côte de la pastille « à faire » (le cercle, pas son contenu). */
private val DONE_DOT_SIZE = 26.dp

/** Lignes de consigne avant repli : elle peut faire 2000 caractères
 *  (`Assignment.MAX_DESCRIPTION`), donc rendue en entier elle noyait l'écran. */
private const val DESCRIPTION_MAX_LINES = 3

/** Au-delà, la consigne est dite « longue » et se déplie au tap. */
private const val DESCRIPTION_EXPAND_CHARS = 160

/** Atténuation du contenu d'un devoir fait (avec la rayure et la pastille pleine). */
private const val DONE_ALPHA = 0.6f

// Regroupement par jour de dueDate (ordre du contrat conservé) : le "badge
// semaine" est dérivé de l'ISO, jamais stocké ni calculé par le serveur.
fun assignmentsByDay(list: List<Assignment>): List<Pair<String, List<Assignment>>> {
    val byDay = linkedMapOf<String, MutableList<Assignment>>()
    for (a in list) {
        val day = Assignment.dayLabel(a.dueDate)
        if (day.isEmpty()) continue
        byDay.getOrPut(day) { mutableListOf() }.add(a)
    }
    return byDay.entries.sortedBy { it.key }.map { it.key to it.value.toList() }
}

fun assignmentsFromPayload(payload: String?): List<Assignment> = try {
    if (payload == null) emptyList() else AssignmentsRepository.parse(payload)
} catch (_: Exception) {
    emptyList()
}

/** Icône d'une section (décorative : c'est le titre qui porte le sens). */
private fun sectionIcon(id: String): ImageVector = when (id) {
    SECTION_OVERDUE -> Icons.Filled.Warning
    SECTION_TODAY -> Icons.Filled.DateRange
    SECTION_DONE -> Icons.Filled.CheckCircle
    else -> Icons.AutoMirrored.Filled.ArrowForward
}

/**
 * En-tête de section : gras, gris, compte, chevron de repli.
 *
 * `PapSectionHeader` (#136) peint son titre dans `onSurfaceVariant` et n'a ni
 * variante de couleur ni action de repli : « En retard » en rouge et le chevron
 * des « Terminés » sont posés ici plutôt que de lui faire rendre un jeton.
 */
@Composable
private fun AssignmentSectionHeader(
    section: AssignmentSectionUi,
    collapsed: Boolean,
    onToggle: () -> Unit,
    background: Color,
) {
    val accent = if (section.id == SECTION_OVERDUE) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            // Le fond est PEINT : l'en-tête est collant, donc il passerait sinon
            // par-dessus les cartes au lieu de les pousser.
            .background(background)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(imageVector = sectionIcon(section.id), contentDescription = null, tint = accent, modifier = Modifier.size(20.dp))
        Text(
            text = section.title,
            style = MaterialTheme.typography.titleMedium,
            color = accent,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (section.count > 0) {
            Text(text = "${section.count}", style = MaterialTheme.typography.labelMedium, color = accent)
        }
        if (section.id == SECTION_DONE) {
            IconButton(onClick = onToggle) {
                Icon(
                    imageVector = if (collapsed) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowUp,
                    contentDescription = if (collapsed) {
                        "Déplier les devoirs terminés"
                    } else {
                        "Replier les devoirs terminés"
                    },
                    tint = accent,
                )
            }
        }
    }
}

/** « ‹  05/10 – 11/10  › » : la navigation RE-CHARGE le serveur (la plage part
 *  dans la query de l'API), elle ne filtre pas la liste en mémoire. */
@Composable
private fun WeekNavigator(weekRange: String, onShiftWeek: (Long) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = { onShiftWeek(-1) }) {
            Icon(imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Semaine précédente")
        }
        Text(
            text = weekRange,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        IconButton(onClick = { onShiftWeek(1) }) {
            Icon(imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Semaine suivante")
        }
    }
}

/** Chips matière : une pastille emoji + la couleur des préférences (#83), en
 *  défilement horizontal — les douze matières d'une demi-classe ne doivent pas
 *  manger la place des devoirs. Aucune matière = aucune rangée de puces. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SubjectFilterRow(
    subjects: List<String>,
    prefs: List<SubjectPrefs>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    if (subjects.isEmpty()) return
    val styles = subjects.map { it to subjectStyle(prefs, it) }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item(key = "chip-toutes") {
            FilterChip(
                selected = selected.isNullOrEmpty(),
                onClick = { onSelect(null) },
                label = { Text("Toutes") },
            )
        }
        items(styles, key = { it.first }) { (subject, style) ->
            // material3 1.2.1 : `FilterChipDefaults.filterChipColors()` ne prend
            // AUCUN paramètre (les 12 couleurs sont restées internes jusqu'à la
            // 1.3), donc la couleur de matière passe par l'encre du libellé —
            // emoji + couleur, la pastille de Papillon. Le fond de la puce
            // sélectionnée reste le `secondaryContainer` du thème (vert pâle).
            val ink = colorFromHex(subjectColorHex(prefs, subject)) ?: LocalContentColor.current
            FilterChip(
                selected = selected == subject,
                onClick = { onSelect(if (selected == subject) null else subject) },
                label = { Text(style.badge, color = ink) },
            )
        }
    }
}

/** Carte de devoir : l'anatomie de papillon.bzh — pastille matière + matière
 *  dans sa couleur, échéance en gris à droite, consigne BORNÉE, rangée du bas
 *  avec l'état « fait ». */
@Composable
private fun PapTaskCard(
    a: Assignment,
    prefs: List<SubjectPrefs>,
    nowMillis: Long,
    zone: ZoneId,
    onToggle: (Assignment, Boolean) -> Unit,
    onOpenAttachment: (AssignmentAttachment) -> Unit,
    onHelp: ((Assignment) -> Unit)?,
) {
    val style = subjectStyle(prefs, a.subject)
    // #137 : la couleur de matière vient du résolveur UNIQUE (préfs d'abord,
    // sinon dérivée du nom sur la palette) — donc une matière sans prefs porte
    // quand même SA couleur, au lieu du vert de repli de l'app.
    val hex = subjectColorHex(prefs, a.subject)
    // `tint` = la matière brute (pastille, avatar, pastille « fait ») ; `ink` =
    // son encre mesurée (`subjectContent`, −45 %, 4.5:1 sur les 20 couleurs) :
    // le NOM de la matière est du corps de texte, pas un aplat.
    val tint = colorFromHex(hex) ?: MaterialTheme.colorScheme.primary
    val ink = subjectContent(hex) ?: MaterialTheme.colorScheme.onSurface
    var expanded by remember(a.id) { mutableStateOf(false) }
    Card(
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = CARD_ELEVATION),
        border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PapSubjectAvatar(emoji = style.emoji, color = tint)
                Column(modifier = Modifier.weight(1f).alpha(if (a.done) DONE_ALPHA else 1f)) {
                    Text(
                        text = style.label,
                        style = MaterialTheme.typography.titleSmall,
                        color = ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = a.title,
                        style = MaterialTheme.typography.bodyMedium,
                        textDecoration = if (a.done) TextDecoration.LineThrough else null,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    text = assignmentDueLabel(a.dueDate, nowMillis, zone),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            if (a.description.isNotBlank()) {
                // Consigne du devoir : texte enseignant affiché tel quel (donnée).
                Text(
                    text = a.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = if (expanded) Int.MAX_VALUE else DESCRIPTION_MAX_LINES,
                    overflow = TextOverflow.Ellipsis,
                )
                if (a.description.length > DESCRIPTION_EXPAND_CHARS) {
                    TextButton(
                        onClick = { expanded = !expanded },
                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
                    ) {
                        Text(if (expanded) "Réduire" else "Voir plus", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            val lesson = a.lessonContent
            if (lesson != null) {
                PapPill(text = "Cours : ${lesson.title}", color = tint)
            }
            if (a.attachments.isNotEmpty()) {
                AttachmentChips(attachments = a.attachments, onOpen = onOpenAttachment)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // 0.7.0 : l'assistant est une AIDE, jamais une écriture (I7) — il
                // n'écrit rien dans l'établissement, il rend un corrigé à l'écran.
                if (onHelp != null) HomeworkHelpButton { onHelp(a) }
                Box(modifier = Modifier.weight(1f))
                DoneToggle(done = a.done, color = tint) { onToggle(a, !a.done) }
            }
        }
    }
}

/**
 * Bascule « fait » : un CERCLE gris à cocher tant que le devoir reste à faire,
 * une PASTILLE pleine dans la couleur de la matière quand il est fait. Ce n'est
 * plus un bouton dont on inversait le libellé : la FORME porte l'état, donc le
 * retour de l'update optimiste est visible sans lire un mot.
 *
 * L'encre de la pastille est choisie par contraste mesuré (`bestContentOn`) : un
 * blanc en dur tomberait à 1.3:1 sur un jaune clair de la palette.
 */
@Composable
private fun DoneToggle(done: Boolean, color: Color?, onToggle: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val tint = color ?: MaterialTheme.colorScheme.primary
    val click = {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        onToggle()
    }
    if (done) {
        // `Role.Checkbox` : la pastille EST une case à cocher, donc un lecteur
        // d'écran doit l'annoncer comme telle (et son état) au lieu d'un bouton.
        Surface(
            modifier = Modifier.clickable(onClick = click, role = Role.Checkbox),
            shape = MaterialTheme.shapes.small,
            color = tint,
        ) {
            Text(
                text = "✓ Terminé",
                style = MaterialTheme.typography.labelMedium,
                color = bestContentOn(tint),
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    } else {
        Box(
            modifier = Modifier
                .size(DONE_DOT_SIZE)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(HAIRLINE, MaterialTheme.colorScheme.outline, CircleShape)
                .clickable(onClick = click, role = Role.Checkbox),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = "Marquer le devoir comme fait",
                tint = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/**
 * Pièces jointes en PUCES CLIQUABLES : AVANT #138 l'URL du proxy s'affichait en
 * texte (`Pièce jointe : fiche.pdf — https://…`), donc illisible et impossible
 * à ouvrir.
 *
 * L'URL n'est construite qu'au tap, dans la route, à partir de la `ref` OPAQUE :
 * elle n'est jamais journalisée et pointe le proxy serveur (`/v1/media`), jamais
 * un hôte tiers — aucune adresse d'établissement ne sort de l'app (I1).
 */
@Composable
private fun AttachmentChips(attachments: List<AssignmentAttachment>, onOpen: (AssignmentAttachment) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (att in attachments) {
            Surface(
                modifier = Modifier.clickable { onOpen(att) },
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.surfaceVariant,
                border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outline),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(text = "📎", style = MaterialTheme.typography.labelSmall)
                    Text(
                        text = att.label,
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun AssignmentsScreen(
    weekLabel: String,
    weekRange: String,
    sections: List<AssignmentSectionUi>,
    subjects: List<String>,
    subjectPrefs: List<SubjectPrefs>,
    selectedSubject: String?,
    query: String,
    doneOpen: Boolean,
    isLoading: Boolean,
    isStale: Boolean,
    fetchedAt: Long?,
    error: String?,
    notice: String?,
    nowMillis: Long,
    zone: ZoneId,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    onQueryChange: (String) -> Unit,
    onSubjectChange: (String?) -> Unit,
    onShiftWeek: (Long) -> Unit,
    onToggleDoneSection: () -> Unit,
    onToggle: (Assignment, Boolean) -> Unit,
    onOpenAttachment: (AssignmentAttachment) -> Unit,
    // 0.7.0 : null = aucun assistant (pas de dépôt injecté) = pas de bouton.
    onHelp: ((Assignment) -> Unit)? = null,
) {
    val hasFilter = !selectedSubject.isNullOrEmpty() || query.isNotBlank()
    val page = MaterialTheme.colorScheme.surfaceVariant
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(page)
            .padding(horizontal = 16.dp),
    ) {
        // En-tête : « Semaine 41 » en gras + « Devoirs de la semaine » en gris, le
        // couple de papillon.bzh ; l'Actualiser à droite. La PLAGE, elle, est dans
        // le navigateur de semaine juste en dessous (une seule fois à l'écran), et
        // le titre de l'onglet (« Tâches », barre du haut) n'est pas répété ici.
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(weekLabel, style = MaterialTheme.typography.titleLarge)
                Text(
                    text = "Devoirs de la semaine",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onRefresh) {
                Icon(imageVector = Icons.Filled.Refresh, contentDescription = "Actualiser les devoirs")
            }
        }
        WeekNavigator(weekRange = weekRange, onShiftWeek = onShiftWeek)
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            label = { Text("Rechercher un devoir") },
            leadingIcon = { Icon(imageVector = Icons.Filled.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        SubjectFilterRow(subjects = subjects, prefs = subjectPrefs, selected = selectedSubject, onSelect = onSubjectChange)
        if (!notice.isNullOrEmpty()) {
            Text(
                text = notice,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(vertical = 4.dp),
            )
        }
        if (isStale) PapStaleBanner(fetchedAt = fetchedAt, onRefresh = onRefresh)
        // `weight(1f)` : AVANT #138, le `LazyColumn` n'était PAS pondéré et le
        // bouton « Actualiser » qui le suivait devenait hors d'atteinte dès que la
        // liste débordait. Ici la zone liste occupe toute la hauteur restante, et
        // les états possibles la remplissent au lieu de flotter en haut.
        Box(modifier = Modifier.weight(1f)) {
            when {
                isLoading && sections.isEmpty() -> Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    PapLoading()
                }
                error != null && sections.isEmpty() -> Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    PapErrorState(message = error, onRetry = onRetry)
                }
                sections.isEmpty() -> Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    PapEmptyState(
                        icon = Icons.Filled.CheckCircle,
                        title = if (hasFilter) "Aucun devoir ne correspond" else "Aucun devoir cette semaine",
                        description = if (hasFilter) {
                            "Aucun devoir de la semaine affichée ne porte ces mots ni cette matière."
                        } else {
                            "Rien à rendre pour le moment."
                        },
                        action = { TextButton(onClick = onRefresh) { Text("Actualiser") } },
                    )
                }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
                ) {
                    for (section in sections) {
                        val collapsed = section.id == SECTION_DONE && !doneOpen
                        // En-tête COLLANT : en descendant la liste, on sait toujours
                        // dans quelle section on se trouve.
                        stickyHeader(key = "section-${section.id}") {
                            AssignmentSectionHeader(
                                section = section,
                                collapsed = collapsed,
                                onToggle = onToggleDoneSection,
                                background = page,
                            )
                        }
                        // « Terminés » replié : le compte du titre suffit, aucune
                        // carte n'est composée (rien à mesurer, rien à rater).
                        if (!collapsed) {
                            for ((day, items) in section.days) {
                                // Un seul groupe = le titre de section suffit : le
                                // jour n'y ajouterait que du bruit.
                                if (section.days.size > 1) {
                                    item(key = "jour-${section.id}-$day") {
                                        Text(
                                            text = Assignment.dayLabelFr(day),
                                            style = MaterialTheme.typography.titleSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                items(items, key = { "${section.id}-${it.id}" }) { a ->
                                    PapTaskCard(
                                        a = a,
                                        prefs = subjectPrefs,
                                        nowMillis = nowMillis,
                                        zone = zone,
                                        onToggle = onToggle,
                                        onOpenAttachment = onOpenAttachment,
                                        onHelp = onHelp,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// Route câblée sur SyncedRepository (ressource "assignments", TTL 15 min) :
// cache synchrone au démarrage, refresh réseau, repli cache hors-ligne.
// Toggle Optimiste : l'affichage bascule tout de suite, retour arrière si le
// serveur refuse (401 session expirée / 409 inconnu / 501 non supporté / réseau).
@Composable
fun AssignmentsRoute(
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    accountId: String,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // Bearer du device appairé (contrat 0.4.0), relu à chaque requête.
    tokens: TokenStore? = null,
    // Clé LLM de l'appelant (0.7.0) : null = assistant non câblé, donc ni
    // bouton ni appel. Elle reste dans le store, jamais dans l'état d'écran.
    llmKeys: LlmKeyStore? = null,
) {
    val api = remember(baseUrl, tokens) { ApiClient(baseUrl, tokens = tokens) }
    val toggleRepo = remember(api) { AssignmentsRepository(api) }
    val helpRepo = remember(api, llmKeys) { llmKeys?.let { HomeworkRepository(api, it) } }
    val zone = remember { ZoneId.systemDefault() }
    val main = remember { Handler(Looper.getMainLooper()) }
    val context = LocalContext.current
    var helpFor by remember { mutableStateOf<Assignment?>(null) }
    var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    // Curseur de semaine : un ISO court (lundi), recalculé à chaque rechargement.
    var week by remember { mutableStateOf(weekStartIso(nowMillis, zone)) }
    var query by remember { mutableStateOf("") }
    var selectedSubject by remember { mutableStateOf<String?>(null) }
    var doneOpen by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    // Toggle Optimiste : on patche la liste affichée, revert sur échec.
    var pending by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var state by remember {
        val c = try {
            repo.cached(resource)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(uiStateFromCache(c, c != null && repo.isStale(resource, c)))
    }

    fun onOutcome(o: RefreshOutcome) {
        state = uiStateFromOutcome(o)
        nowMillis = System.currentTimeMillis()
        // Le payload fait foi : l'état optimiste n'est plus nécessaire.
        if (o !is RefreshOutcome.Failed) pending = null
    }

    fun refresh() {
        // Serveur non configuré : aucun appel (I1).
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            return
        }
        state = when (val s = state) {
            is UiState.Data -> s
            else -> UiState.Loading
        }
        // La semaine demandée est CAPTURÉE : deux taps rapides sur « ‹ › » lancent
        // deux requêtes, et la réponse de la première (plus lente) arrived après
        // la seconde. Sans ce garde, l'en-tête afficherait une semaine avec la
        // liste de l'autre.
        val requested = week
        fun accept(o: RefreshOutcome) {
            if (week == requested) onOutcome(o)
        }
        try {
            if (week == weekStartIso(nowMillis, zone)) {
                repo.refreshAsync(resource, baseUrl) { o -> accept(o) }
            } else {
                // Semaine différente : la plage part DANS la requête — c'est le
                // point de #138 — donc ce chemin ne passe pas par le cache.
                fetchAssignmentsWeek(api, baseUrl, week, repo, resource, main) { o -> accept(o) }
            }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
            pending = null
        }
    }
    // Changer de semaine RE-DÉCLENCHE le chargement réseau : garder la liste de la
    // semaine précédente sous le titre de la nouvelle serait un mensonge d'écran.
    LaunchedEffect(week) { refresh() }

    val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
    val list = assignmentsFromPayload(payload)
    val optimistic = pending?.let { (id, done) -> list.map { if (it.id == id) it.copy(done = done) else it } } ?: list
    val visible = filterAssignments(optimistic, selectedSubject, query)
    val sections = assignmentSections(visible, nowMillis, zone)
    val errorMessage = (state as? UiState.Error)?.message
    // Erreur AVEC cache : les cartes s'affichent, donc l'écran d'erreur n'a pas
    // sa place — le message passe en bandeau, sinon il était JETÉ (le défaut que
    // #136 corrigeait dans les autres écrans).
    val shownNotice = if (sections.isEmpty()) notice else (notice ?: errorMessage)

    fun openAttachment(att: AssignmentAttachment) {
        // Jamais d'adresse d'établissement : la `ref` opaque passe par le PROXY
        // serveur, qui résout et stream les octets (règle d'or média).
        val url = AssignmentsRepository.mediaUrl(baseUrl, accountId, att.ref)
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // ponytail: aucun journal — une URL finit dans les logs d'accès. Le proxy
        // exige le jeton d'appareil, qu'aucune application externe ne peut porter :
        // l'ouvreur affiche donc « session requise » tant qu'aucun FileProvider
        // (module app) ne sert les octets téléchargés par l'app.
        // Upgrade: FileProvider + téléchargement par l'app, comme la photo #82.
        notice = try {
            context.startActivity(intent)
            null
        } catch (_: Exception) {
            "Aucune application ne peut ouvrir cette pièce jointe."
        }
    }

    AssignmentsScreen(
        weekLabel = weekLabelFr(week),
        weekRange = weekRangeFr(week),
        sections = sections,
        subjects = payload?.let { subjectsFromPayload(it) } ?: emptyList(),
        subjectPrefs = subjectPrefs,
        selectedSubject = selectedSubject,
        query = query,
        doneOpen = doneOpen,
        isLoading = state is UiState.Loading,
        isStale = (state as? UiState.Data)?.isStale == true,
        fetchedAt = (state as? UiState.Data)?.fetchedAt,
        error = errorMessage,
        notice = shownNotice,
        nowMillis = nowMillis,
        zone = zone,
        onRefresh = { refresh() },
        onRetry = { refresh() },
        onQueryChange = { query = it },
        onSubjectChange = { selectedSubject = it },
        onShiftWeek = { weeks ->
            week = shiftWeekIso(week, weeks)
            // On repart de zéro : afficher la semaine précédente sous le titre de la
            // nouvelle ferait croire que le serveur a répondu.
            state = UiState.Loading
            pending = null
            notice = null
        },
        onToggleDoneSection = { doneOpen = !doneOpen },
        onToggle = { a, done ->
            pending = a.id to done
            notice = null
            toggleRepo.toggle(baseUrl, a.id, done) { o ->
                if (o.assignment == null) {
                    // Retour arrière immédiat : l'affichage revient au cache.
                    pending = null
                    notice = o.error
                } else {
                    // Succès : resync du cache (invalidation par événement), l'état
                    // optimiste reste affiché jusqu'à l'arrivée du payload à jour.
                    notice = null
                    refresh()
                }
            }
        },
        onOpenAttachment = { att -> openAttachment(att) },
        onHelp = if (helpRepo == null) null else ({ a -> helpFor = a }),
    )
    // Le dialogue porte son propre état (question éditable, résultat) : il est
    // retiré de l'arbre à la fermeture, donc aucun souvenir d'une clé ou d'un
    // corrigé ne survit au changement de devoir.
    val current = helpFor
    if (current != null && helpRepo != null) {
        HomeworkHelpDialog(
            assignment = current,
            baseUrl = baseUrl,
            repo = helpRepo,
            keyConfigured = llmKeys?.isConfigured() == true,
            onDismiss = { helpFor = null },
        )
    }
}

/**
 * GET /v1/assignments?weekStart=<lundi> : la fenêtre part au SERVEUR.
 *
 * `SyncedRepository.pathFor` ignore la query de `assignments` (seule `timetable`
 * la relaie), donc la fenêtre passe par ce GET, sur le MÊME `ApiClient` — donc
 * la même allowlist serveur (I1) et le même bearer relu à chaque requête. Les
 * replis sont ceux de `refreshAsync` : cache s'il existe (bandeau « périmé »),
 * sinon échec franc ; un 401 reste nu, le cache ne masque pas une session morte.
 *
 * ponytail: ce chemin ne peut pas écrire le cache disque (le `CacheStore` est
 * privé de `SyncedRepository`) : seule la semaine courante reste mémorisée pour
 * l'affichage hors-ligne. Upgrade: relayer `query` dans `pathFor(ASSIGNMENTS)`
 * (module data) et supprimer cette fonction.
 */
private fun fetchAssignmentsWeek(
    api: ApiClient,
    baseUrl: String,
    weekStart: String,
    repo: SyncedRepository,
    resource: String,
    main: Handler,
    cb: (RefreshOutcome) -> Unit,
) {
    val request = try {
        // Chemin issu de ServerConfig seul (I1), jamais une URL concaténée ici.
        val url = ServerConfig.assignmentsUrl(baseUrl, null, null, weekStart)
        api.buildGet(url.removePrefix(baseUrl))
    } catch (_: IllegalArgumentException) {
        assignmentsOffline(main, cb, repo, resource, "URL hors allowlist serveur")
        return
    }
    api.client().newCall(request).enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            assignmentsOffline(main, cb, repo, resource, "Hors-ligne, aucune donnée en cache.")
        }

        override fun onResponse(call: Call, response: Response) {
            response.use {
                if (it.code == ApiClient.HTTP_UNAUTHORIZED) {
                    postOutcome(main, cb, RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null))
                    return
                }
                val body = if (it.isSuccessful) it.body?.string() else null
                if (body.isNullOrEmpty()) {
                    assignmentsOffline(main, cb, repo, resource, "Réponse serveur ${it.code}.")
                    return
                }
                // Contenu serveur = donnée affichée, jamais interprétée (I6).
                postOutcome(main, cb, RefreshOutcome.Updated(body, System.currentTimeMillis()))
            }
        }
    })
}

/** Repli hors-ligne commun aux deux causes d'échec de la fenêtre. */
private fun assignmentsOffline(
    main: Handler,
    cb: (RefreshOutcome) -> Unit,
    repo: SyncedRepository,
    resource: String,
    message: String,
) {
    val entry = try {
        repo.cached(resource)
    } catch (_: Exception) {
        null
    }
    val outcome = if (entry != null) {
        RefreshOutcome.OfflineFallback(entry.payload, entry.fetchedAt, repo.isStale(resource, entry))
    } else {
        RefreshOutcome.Failed(message, null)
    }
    postOutcome(main, cb, outcome)
}

/** Callback sur le thread UI, comme `SyncedRepository.post`. */
private fun postOutcome(main: Handler, cb: (RefreshOutcome) -> Unit, outcome: RefreshOutcome) {
    try {
        main.post { cb(outcome) }
    } catch (_: Exception) {
        cb(outcome)
    }
}

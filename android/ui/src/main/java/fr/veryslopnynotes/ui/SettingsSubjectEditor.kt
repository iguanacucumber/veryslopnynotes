package fr.veryslopnynotes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SubjectPrefs
import java.time.ZoneId

// ÉDITEUR DE MATIÈRE EN FEUILLE #140 (parité Papillon).
//
// AVANT (`SettingsScreen.kt`), chaque matière avait un bloc TOUJOURS déployé :
// champ libellé, champ emoji, huit pastilles et un bouton « Enregistrer ».
// Douze matières = douze blocs et une centaine de pastilles composées d'un coup,
// dans une colonne SANS défilement : l'écran ne pouvait pas être parcouru, et
// la couleur choisie ne changeait rien de visible à l'écran.
//
// MAINTENANT : une LIGNE par matière, et la matière s'édite dans une FEUILLE
// MODALE (comme chez papillon.bzh) qui porte :
//   - un APERÇU VIVANT : la couleur et l'emoji choisis s'appliquent aux
//     COMPOSANTS RÉELS — la carte de cours de l'EDT (`PapCourseCard`) et la
//     pastille matière de la carte de devoir (`PapSubjectAvatar`) avec la
//     pastille de note (`PapPill`). Ce que l'on règle est donc exactement ce
//     qui apparaîtra sur les trois écrans, pas une approximation décrite ;
//   - le nom, la COULEUR (roue de pastilles circulaires, anneau blanc, coche sur
//     la sélection) et l'EMOJI (rangée de pastilles, sélection teintée) ;
//   - la croix (annule) à gauche et la coche verte (valide) à droite.
//
// Fermer la feuille ANNULE : rien n'est écrit tant que la coche n'est pas
// pressée, et l'écriture passe par la même porte qu'avant (`onSavePrefs` →
// `SubjectPrefsRepository.upsert`), donc la persistance locale et la réplication
// serveur (allowlist seule, I1) ne changent pas.
//
// Les couleurs viennent de `PapillonTheme.kt` : la palette matière (20 couleurs
// déjà MESURÉES par `android-papillon-theme.test.ts`) et les deux fonctions de
// matière `subjectSurface` / `subjectContent`. AUCUNE couleur en dur ici, donc le
// thème sombre est correct sans seconde feuille de style.

/**
 * Côte d'une pastille de couleur et d'emoji : [TouchTarget] (48 dp).
 *
 * #146 : 44 dp — sous le minimum Material. La pastille est une cible de toucher,
 * pas un simple glyphe : elle passe à 48 dp, comme les boutons de la barre.
 */
private val SWATCH = TouchTarget

/** Épaisseur de l'anneau blanc de la pastille sélectionnée. */
private val SWATCH_RING = 3.dp

/** Épaisseur du filet d'une pastille non sélectionnée. */
private val SWATCH_HAIRLINE = 1.dp

/** Côte du glyphe dans une pastille. */
private val SWATCH_ICON = 20.dp

/** Côte du bouton circulaire de la barre de feuille (cible tactile Material). */
private val SHEET_BUTTON = 48.dp

/** Côte du DISQUE du bouton circulaire (40 dp : la cible garde ses 48 dp). */
private val SHEET_DISC = 40.dp

/**
 * Note d'exemple de l'aperçu : ce n'est PAS une donnée du serveur, c'est le
 * gabarit « 15,5/20 » de l'app de référence, qui montre où la pastille se pose.
 */
private const val PREVIEW_GRADE = "15,5/20"

/**
 * Brouillon d'édition : ce que l'utilisateur a TAPÉ, jamais ce qui est stocké.
 * Les trois champs sont des chaînes brutes (une couleur peut être fausse, un
 * libellé peut dépasser) : la validation reste à l'écriture, comme avant.
 */
data class SubjectDraft(
    val label: String = "",
    val colorHex: String = "",
    val emoji: String = "",
)

/** Brouillon initialisé depuis les prefs enregistrées (vide pour une nouvelle). */
fun subjectDraft(prefs: SubjectPrefs?): SubjectDraft = SubjectDraft(
    label = prefs?.label?.trim().orEmpty(),
    colorHex = prefs?.color?.trim().orEmpty(),
    emoji = prefs?.emoji?.trim().orEmpty(),
)

/**
 * Couleur de l'aperçu : celle du brouillon si elle est valide, sinon celle de la
 * matière (préfs enregistrées, ou dérivée du nom par #137). Jamais une couleur
 * inventée : la roue montre 20 couleurs mesurées, et l'aperçu ne montre jamais
 * autre chose que ce que l'app affichera vraiment.
 */
fun subjectPreviewHex(prefs: List<SubjectPrefs>, subject: String, draftHex: String): String =
    normalizeColorHex(draftHex) ?: subjectColorHex(prefs, subject)

/**
 * Couleurs proposées : la palette matière du thème, plus la couleur enregistrée
 * quand elle n'y figure pas (une prefs écrite avant #140 peut venir d'une autre
 * palette — elle doit rester sélectionnée, donc visible, sinon l'utilisateur
 * croit l'avoir perdue).
 */
fun subjectSwatchColors(current: String?): List<String> {
    val hex = normalizeColorHex(current)
    val known = SubjectPalette.any { it.equals(hex, ignoreCase = true) }
    return if (hex == null || known) SubjectPalette else SubjectPalette + hex
}

/**
 * Palette d'emoji : une rangée courte et stable. Papillon propose des familles
 * d'icônes de matière ; hors `material-icons-extended` (interdit ici, cf. le
 * `ponytail:` de `HomeCards.kt`), un glyphe = un caractère. Tous tiennent dans
 * le contrat (≤ 8 points de code, cf. `SubjectPrefs.isValid`).
 */
val SubjectEmojiPalette: List<String> = listOf(
    "📘", "📐", "🔬", "🌍", "🗺️", "📜", "🧮", "🎨", "🎵", "💻", "⚽", "🌱",
)

/**
 * Emoji de la rangée, PLUS celui de la matière quand il n'y figure pas.
 *
 * AVANT #140, le champ « Emoji » était libre : n'importe quel glyphe du contrat
 * pouvait être enregistré. Sans cet ajout, un emoji enregistré mais plus proposé
 * deviendrait impossible à voir — donc impossible à retirer (l'écran n'offre plus
 * de saisie libre). Même règle que [subjectSwatchColors] côté couleur.
 */
fun subjectEmojiChoices(current: String?): List<String> {
    val emoji = current?.trim().orEmpty()
    if (emoji.isEmpty() || emoji.codePointCount(0, emoji.length) > SubjectPrefs.MAX_EMOJI_CHARS) {
        return SubjectEmojiPalette
    }
    return if (SubjectEmojiPalette.any { it == emoji }) SubjectEmojiPalette else SubjectEmojiPalette + emoji
}

/**
 * Message d'erreur du champ « matière à personnaliser », `null` s'il n'y a rien
 * à dire. Vide = rien à dire (le bouton est de toute façon désactivé) ; trop
 * long = la raison du refus, la même borne que le contrat.
 */
fun subjectNameError(name: String): String? {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return null
    if (trimmed.length > SubjectPrefs.MAX_SUBJECT_CHARS) {
        return "${SubjectPrefs.MAX_SUBJECT_CHARS} caractères maximum"
    }
    return null
}

/** Feuille d'édition d'une matière : aperçu, nom, couleur, emoji. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubjectEditorSheet(
    subject: String,
    prefs: List<SubjectPrefs>,
    saved: SubjectPrefs?,
    onSave: (color: String?, emoji: String?, label: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    // `remember(subject)` : le brouillon d'une matière ne doit pas survivre à
    // l'ouverture d'une autre, et la feuille qui sort de la composition perd son
    // état — donc rouvrir le même sujet repart de l'état enregistré.
    var draft by remember(subject) { mutableStateOf(subjectDraft(saved)) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SheetHeader(
                title = "Modifier la matière",
                onClose = onDismiss,
                onConfirm = {
                    // `null` = champ laissé vide : le contrat rejette une prefs
                    // vide, donc on écrit « pas de libellé / pas d'emoji », et la
                    // matière retombe sur son nom et sa couleur dérivée (#137).
                    onSave(
                        normalizeColorHex(draft.colorHex),
                        draft.emoji.trim().takeIf { it.isNotEmpty() },
                        draft.label.trim().takeIf { it.isNotEmpty() },
                    )
                    onDismiss()
                },
            )
            SubjectPreview(subject = subject, prefs = prefs, draft = draft)
            OutlinedTextField(
                value = draft.label,
                onValueChange = { draft = draft.copy(label = it) },
                label = { Text("Nom de la matière") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            SheetLabel("Couleur")
            SubjectSwatchRow(
                selected = draft.colorHex,
                onSelect = { hex ->
                    // Re-cliquer la couleur sélectionnée l'enlève : la matière
                    // reprend alors la couleur dérivée de son nom (#137).
                    draft = draft.copy(
                        colorHex = if (draft.colorHex.equals(hex, ignoreCase = true)) "" else hex,
                    )
                },
            )
            SheetLabel("Emoji")
            SubjectEmojiRow(
                selected = draft.emoji,
                onSelect = { emoji ->
                    draft = draft.copy(emoji = if (draft.emoji == emoji) "" else emoji)
                },
            )
        }
    }
}

/** Titre centré, croix à gauche (annule), coche à droite (valide) : la barre de
 *  la feuille d'édition de papillon.bzh.
 *
 *  Deux boutons CIRCULAIRES, pas deux boutons de plus large : sur une feuille,
 *  l'action de gauche annule et celle de droite valide, et rien d'autre.
 */
@Composable
private fun SheetHeader(title: String, onClose: () -> Unit, onConfirm: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SheetDisc(
            icon = Icons.Filled.Close,
            label = "Annuler",
            background = MaterialTheme.colorScheme.surfaceVariant,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            onClick = onClose,
        )
        // `heading()` : le titre de la feuille est le titre de l'écran.
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp).semantics { heading() },
        )
        SheetDisc(
            icon = Icons.Filled.Check,
            label = "Enregistrer",
            background = MaterialTheme.colorScheme.primary,
            tint = MaterialTheme.colorScheme.onPrimary,
            onClick = onConfirm,
        )
    }
}

/**
 * Bouton circulaire : disque de 40 dp dans la cible tactile de 48 dp, glyphe
 * teinté par le fond. `label` est le `contentDescription` du glyphe, donc c'est
 * ce qu'un lecteur d'écran annonce (« Annuler », « Enregistrer ») — pas
 * « bouton ».
 */
@Composable
private fun SheetDisc(
    icon: ImageVector,
    label: String,
    background: Color,
    tint: Color,
    onClick: () -> Unit,
) {
    IconButton(onClick = onClick, modifier = Modifier.size(SHEET_BUTTON)) {
        Box(
            modifier = Modifier
                .size(SHEET_DISC)
                .clip(CircleShape)
                .background(background),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = tint,
                modifier = Modifier.size(SWATCH_ICON),
            )
        }
    }
}

/** Intitulé d'un bloc de la feuille (Couleur, Emoji) : même encre que
 *  `PapSectionHeader`, donc les trois niveaux de titre se ressemblent. */
@Composable
private fun SheetLabel(text: String) {
    // `heading()` : « Couleur » et « Emoji » sont les deux sections de la feuille.
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.semantics { heading() },
    )
}

/**
 * APERÇU VIVANT : les trois rendus que la couleur et l'emoji changent
 * réellement — carte de cours de l'EDT, carte de devoir, pastille de note.
 *
 * Ce sont les MÊMES composants que les écrans (#137 / #138 / #139) :
 * `PapCourseCard` avec la couleur du brouillon, `PapSubjectAvatar` pour la
 * pastille matière et `PapPill` pour la note. L'aperçu ne peut donc pas mentir
 * sur le rendu final : il ne fait que l'avancer.
 */
@Composable
private fun SubjectPreview(subject: String, prefs: List<SubjectPrefs>, draft: SubjectDraft) {
    val hex = subjectPreviewHex(prefs, subject, draft.colorHex)
    val color = colorFromHex(hex) ?: MaterialTheme.colorScheme.primary
    val ink = subjectContent(hex) ?: MaterialTheme.colorScheme.onSurface
    // Le nom passe par la convention de #138 : libellé saisi, sinon nom de la
    // matière en casse de phrase (« ALLEMAND LV2 » → « Allemand LV2 »).
    val label = subjectDisplayFr(draft.label.ifBlank { subject })
    // Sans emoji choisi, l'aperçu montre l'initiale — exactement ce que fait la
    // carte de devoir (#161) plutôt qu'un disque vide.
    val badge = draft.emoji.ifBlank { subjectInitial(subject) }
    val zone = remember { ZoneId.systemDefault() }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "Aperçu",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PapCourseCard(
            lesson = PREVIEW_LESSON,
            label = "$badge $label",
            colorHex = hex,
            zone = zone,
            modifier = Modifier.fillMaxWidth(),
        )
        PapCard(
            modifier = Modifier.fillMaxWidth(),
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PapSubjectAvatar(emoji = badge, color = color)
                Text(
                    text = label,
                    style = MaterialTheme.typography.titleSmall,
                    color = ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                PapPill(text = PREVIEW_GRADE, color = color)
            }
        }
    }
}

/**
 * Cours factice de l'aperçu : SALLES, prof, statut et horaires VIDES, donc la
 * carte ne montre que la matière — un aperçu qui afficherait « Salle A12 »
 * inventerait une donnée de l'établissement.
 */
private val PREVIEW_LESSON = TimetableLessonUi(
    id = "apercu",
    subject = "",
    room = null,
    teacher = null,
    status = null,
    startMillis = 0L,
    endMillis = 0L,
    originalStartMillis = null,
    originalEndMillis = null,
)

/**
 * Roue de couleurs : pastilles CIRCULAIRES, anneau blanc sur la sélection et
 * coche dessus.
 *
 * L'anneau est BLANC (pas la couleur de marque) parce que la pastille porte
 * déjà une couleur de matière : c'est le seul liseré qui reste lisible sur les
 * vingt couleurs, claires comme foncées. La sélection se lit donc à l'anneau ET
 * à la coche, jamais à la seule teinte — une couleur ne peut pas être le seul
 * signal d'un choix.
 */
@Composable
private fun SubjectSwatchRow(selected: String, onSelect: (String) -> Unit) {
    val chosen = normalizeColorHex(selected)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items(subjectSwatchColors(selected)) { hex ->
            val color = colorFromHex(hex) ?: MaterialTheme.colorScheme.primary
            val isSelected = chosen != null && hex.equals(chosen, ignoreCase = true)
            Box(
                modifier = Modifier
                    .size(SWATCH)
                    // Le clip PRÉCÈDE le fond : sans cela la couleur déborde du
                    // cercle, et l'anneau de sélection se lit à l'envers.
                    .clip(CircleShape)
                    .background(color)
                    .then(
                        if (isSelected) {
                            Modifier.border(SWATCH_RING, Color.White, CircleShape)
                        } else {
                            Modifier.border(SWATCH_HAIRLINE, MaterialTheme.colorScheme.outline, CircleShape)
                        },
                    )
                    // Nom + état annoncés : une pastille n'a pas de libellé, donc
                    // sans ça un lecteur d'écran dirait « bouton » 21 fois.
                    // #146 : l'état part désormais de `selectable` +
                    // `Role.RadioButton` (l'arbre de sémantique dit « sélectionné »
                    // et « bouton radio 3 sur 20 ») et `stateDescription` le nomme
                    // en francais — plus la choice d'une couleur seule dans le
                    // `contentDescription`.
                    .selectable(selected = isSelected, role = Role.RadioButton) { onSelect(hex) }
                    .semantics {
                        contentDescription = "Couleur " + hex.uppercase()
                        stateDescription = if (isSelected) "sélectionnée" else "non sélectionnée"
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (isSelected) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        // Décorative : la pastille porte déjà le nom et l'état.
                        contentDescription = null,
                        // L'encre de la coche est MESURÉE (`bestContentOn`) : un
                        // blanc en dur sur une pastille jaune tomberait à 1.1:1.
                        tint = bestContentOn(color),
                        modifier = Modifier.size(SWATCH_ICON),
                    )
                }
            }
        }
    }
}

/**
 * Rangée d'emoji : boutons circulaires, la sélection sur un fond TEINTÉ (le
 * `secondaryContainer` vert pâle du thème) plutôt que sur une bordure — l'emoji
 * est en couleur, une bordure passerait par-dessus lui.
 */
@Composable
private fun SubjectEmojiRow(selected: String, onSelect: (String) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(subjectEmojiChoices(selected)) { emoji ->
            val isSelected = emoji == selected
            Box(
                modifier = Modifier
                    .size(SWATCH)
                    .clip(CircleShape)
                    // Non sélectionné = surface variante (le disque gris de la
                    // rangée), sélectionné = `secondaryContainer` TEINTÉ : deux
                    // fonds du thème, aucun aplat posé ici.
                    .background(
                        if (isSelected) {
                            MaterialTheme.colorScheme.secondaryContainer
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        },
                    )
                    // #146 : ces pastilles n'etaient QUE des boites cliquables —
                    // ni nom, ni état, ni rôle. Un lecteur d'écran annonçait
                    // quatorze fois « bouton » sans dire quel emoji, ni lequel etait
                    // choisi. `selectable` + `Role.RadioButton` +
                    // `stateDescription` repondent aux trois questions.
                    .selectable(selected = isSelected, role = Role.RadioButton) { onSelect(emoji) }
                    .semantics {
                        contentDescription = "Emoji $emoji"
                        stateDescription = if (isSelected) "sélectionné" else "non sélectionné"
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = emoji,
                    style = MaterialTheme.typography.titleLarge,
                    // Décorative : le nom de l'emoji est dans le `contentDescription`
                    // de la pastille, au-dessus.
                    modifier = Modifier.clearAndSetSemantics { },
                )
            }
        }
    }
}

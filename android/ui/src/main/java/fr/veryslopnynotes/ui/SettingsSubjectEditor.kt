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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Face
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.veryslopnynotes.data.SubjectPrefs
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// ÉDITEUR DE MATIÈRE EN FEUILLE #140 (parité Papillon), restylé d'après
// `ref-papillon/opti_custom.jpg` (relevé visuel, aucune copie d'asset).
//
// AVANT (`SettingsScreen.kt`), chaque matière avait un bloc TOUJOURS déployé :
// champ libellé, champ emoji, huit pastilles et un bouton « Enregistrer ».
// Douze matières = douze blocs et une centaine de pastilles composées d'un coup,
// dans une colonne SANS défilement : l'écran ne pouvait pas être parcouru, et
// la couleur choisie ne changeait rien de visible à l'écran.
//
// MAINTENANT : une LIGNE par matière, et la matière s'édite dans une FEUILLE
// MODALE (comme chez papillon.bzh) qui porte :
//   - un APERÇU : UNE carte de note façon carrousel « Nouvelles notes » (#139) —
//     pastille emoji teintée + matière tronquée + date sur une ligne, titre
//     d'évaluation sur deux lignes, pastille de note CONTOUR (`GradePill` avec
//     une note partielle). Mêmes composants et mêmes mesures que le carrousel,
//     donc l'aperçu ne peut pas mentir sur le rendu final : il ne fait que
//     l'avancer. Dessin d'origine : la ref. n'est que relevée (positions,
//     rayons), aucun asset ni style recopié ;
//   - le nom (stade, « A » gras, affiché en majuscules), la COULEUR (pastilles
//     à anneau blanc + ombre douce, coche sur la sélection) et l'EMOJI
//     (disques surface + filet, sélection teintée) ;
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

/** Épaisseur de l'anneau blanc d'une pastille de couleur (sélectionnée). */
private val SWATCH_RING = 3.dp

/** Anneau blanc d'une pastille NON sélectionnée : la ref. les cercle toutes de
 *  blanc, et l'ombre douce les détache de la feuille — le filet gris d'avant
 *  (qui posait une bordure `outline` sur chaque pastille) disparaît. */
private val SWATCH_RING_IDLE = 2.dp

/** Ombre douce sous chaque pastille : c'est elle qui détache l'anneau blanc du
 *  fond blanc de la feuille, comme sur la ref. */
private val SWATCH_SHADOW = 4.dp

/** Épaisseur du filet d'un disque d'emoji non sélectionné. */
private val SWATCH_HAIRLINE = 1.dp

/** Côte du glyphe dans une pastille. */
private val SWATCH_ICON = 20.dp

/** Côte du bouton circulaire de la barre de feuille (cible tactile Material). */
private val SHEET_BUTTON = 48.dp

/**
 * Côte du DISQUE : 48 dp, soit toute la cible.
 *
 * Écart assumé : la ref. montre des disques d'environ 52 dp optiques, mais
 * 52 > 48 déborderait de la cible tactile minimale ([TouchTarget], WCAG 2.5.8
 * + Material) — le disque remplit donc la cible au lieu de la dépasser.
 */
private val SHEET_DISC = 48.dp

/**
 * Rayon haut de la feuille : 28 dp, le jeton `ExpandedShape` de Material3
 * (donc le défaut du composant) et le rayon des cartes du carrousel
 * (`shapes.extraLarge`) — la feuille et l'aperçu partagent la même courbe que
 * la ref. Posé explicitement plutôt que subi par défaut.
 */
private val SHEET_RADIUS = 28.dp

/**
 * Carte d'aperçu : les mesures du carrousel « Nouvelles notes » (`GradesRows.kt`,
 * #139/#192) — largeur 200, blocs à 14/12, écart 8 — pour que l'aperçu et le
 * carrousel partagent la MÊME carte, pas deux approximations.
 */
private val PREVIEW_CARD_WIDTH = 200.dp
private val PREVIEW_CARD_PADDING_H = 14.dp
private val PREVIEW_CARD_PADDING_V = 12.dp
private val PREVIEW_CARD_GAP = 8.dp

/** Pastille emoji de l'aperçu : 30 dp sur `shapes.medium`, comme `SubjectEmojiChip`. */
private val PREVIEW_EMOJI_CHIP = 30.dp

/** Teinte de la pastille emoji : 20 % d'alpha, comme `subjectEmojiChipColor` (privée,
 *  donc re-dérivée ici depuis `subjectCardTint` au lieu d'être dupliquée en dur). */
private const val PREVIEW_EMOJI_ALPHA = 0.2f

/** Corps de l'emoji : 18/25, la surcharge inline du carrousel. */
private val PREVIEW_EMOJI_SIZE = 18.sp
private val PREVIEW_EMOJI_LINE = 25.sp

/**
 * Note d'exemple de l'aperçu : 12,6/20, PARTIELLE donc rendue en variante
 * CONTOUR par `GradePill` (`isGradeFullMark` est faux : 12,6 < 20).
 *
 * Ce ne sont PAS des données du serveur, c'est le gabarit de l'app de
 * référence, qui montre où la pastille se pose. Le libellé passe par
 * `gradeValueLabel` (virgule française) : aucune chaîne « 12.60 » posée ici.
 */
private const val PREVIEW_GRADE_VALUE = 12.6
private const val PREVIEW_GRADE_SCALE = 20.0

/** Titre d'évaluation factice : deux lignes, comme la ref. (« Exemple d'une
 *  note avec la matière »). Donnée factice assumée, jamais envoyée. */
private const val PREVIEW_EVAL_TITLE = "Exemple d\u2019une note avec la mati\u00e8re"

/** Date de l'aperçu : « 18 déc. », le motif court français (`d MMM`, la CLDR
 *  pose le point : « déc. », « mai » reste sans point). */
private val PREVIEW_DATE_FMT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("d MMM", Locale.FRANCE)

/**
 * Affichage du champ nom en MAJUSCULES, sans toucher à la casse enregistrée :
 * `OffsetMapping.Identity` (aucun caractère ajouté ni retiré, le curseur ne
 * bouge pas), seule la couche de rendu passe en capitales.
 *
 * Écart assumé : la ref. ENREGISTRE « HISTOIRE & GEOGRAPH. » en capitales, mais
 * la casse saisie est une donnée (convention #138 : `subjectDisplayFr`)
 * qu'un champ ne doit pas réécrire — l'aperçu garde donc la casse de phrase
 * pendant que le champ affiche des capitales, exactement comme la ref.
 */
private object UppercaseVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText =
        TransformedText(AnnotatedString(text.text.uppercase()), OffsetMapping.Identity)
}

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

/**
 * Les trois saisies du brouillon, en `list` : c'est ce que le `Bundle` de
 * l'activité sait conserver, donc ce que la rotation rend après coup (#147).
 * Un `data class` n'est pas `Serializable`, donc `rememberSaveable` la refuserait
 * — d'où l'export explicite, et non « ça marche tant qu'on ne fait pas tourner ».
 */
val SubjectDraftSaver: Saver<SubjectDraft, Any> = listSaver(
    save = { listOf(it.label, it.colorHex, it.emoji) },
    restore = { SubjectDraft(label = it[0], colorHex = it[1], emoji = it[2]) },
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
    // `rememberSaveable(subject)` : le brouillon d'une matière ne doit pas
    // survivre à l'ouverture d'une autre, et rouvrir le même sujet repart de
    // l'état ENREGISTRÉ — sauf si la feuille a été fermée par une rotation, où
    // le brouillon saisi est justement ce qu'on ne veut pas perdre (#147).
    var draft by rememberSaveable(subject, stateSaver = SubjectDraftSaver) {
        mutableStateOf(subjectDraft(saved))
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = SHEET_RADIUS, topEnd = SHEET_RADIUS),
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
            SheetLabel(text = "Nom de la matière", glyph = "A")
            OutlinedTextField(
                value = draft.label,
                onValueChange = { draft = draft.copy(label = it) },
                label = { Text("Nom de la matière") },
                // « A » gras : la ref. le pose dans le champ comme dans
                // l'en-tête. Décoratif (le libellé du champ porte le sens).
                leadingIcon = {
                    Text(
                        text = "A",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.clearAndSetSemantics { },
                    )
                },
                // Stade + capitales d'affichage : la valeur enregistrée garde
                // sa casse (cf. `UppercaseVisualTransformation`).
                shape = CircleShape,
                visualTransformation = UppercaseVisualTransformation,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            SheetLabel(text = "Couleur", icon = Icons.Filled.Create)
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
            SheetLabel(text = "Emoji", icon = Icons.Filled.Face)
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
 * Bouton circulaire : disque de 48 dp dans la cible tactile de 48 dp (le
 * disque remplit la cible, cf. `SHEET_DISC`), glyphe teinté par le fond.
 * `label` est le `contentDescription` du glyphe, donc c'est
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

/** Intitulé d'un bloc de la feuille : glyphe + libellé, comme la ref.
 *
 *  Le glyphe est soit un « A » gras en toutes lettres (nom : la ref. pose la
 *  lettre, pas une icône — aucun `Icons.Filled.*` ne dessine un « A »), soit
 *  une icône du CORE déjà dans le graphe via material3 : `Face` pour l'emoji
 *  (un smiley, sens littéral), `Create` (crayon) pour la couleur — il n'existe
 *  PAS de palette dans `material-icons-core` 1.6.8 (vérifié dans le
 *  `classes.jar` : ni `Palette`, ni `FormatColorFill`), donc le crayon dit
 *  « personnaliser » sans ajouter `material-icons-extended`.
 *
 *  L'icône est décorative (le libellé porte le sens) ; le libellé porte
 *  `heading()`, comme avant.
 */
@Composable
private fun SheetLabel(text: String, icon: ImageVector? = null, glyph: String? = null) {
    val tint = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when {
            glyph != null -> Text(
                text = glyph,
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = FontWeight.Bold,
                ),
                color = tint,
                maxLines = 1,
                modifier = Modifier.clearAndSetSemantics { },
            )
            icon != null -> Icon(
                imageVector = icon,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(SWATCH_ICON),
            )
        }
        // `heading()` : « Nom de la matière », « Couleur » et « Emoji » sont
        // les trois sections de la feuille.
        Text(
            text = text,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { heading() },
        )
    }
}

/**
 * APERÇU : UNE carte de note façon carrousel « Nouvelles notes » (#139),
 * liée au brouillon (couleur + emoji + libellé).
 *
 * UNE carte au lieu des deux empilées d'avant (carte de cours EDT + carte
 * devoir) : la ref. ne montre qu'une carte de note, et c'est le carrousel —
 * pas l'EDT — qui porte la pastille de note que la couleur habille. Mêmes
 * mesures que `GradesRecentCarousel` (carte 200 dp, blocs 14/12, écart 8,
 * pastille 30 dp à 20 % d'alpha, note en `displaySmall`) : l'aperçu et le
 * carrousel partagent la MÊME carte.
 *
 * Écarts assumés avec la ref. (relevée, jamais copiée) :
 *   - fond = la teinte translucide du carrousel (`subjectCardTint`, 8 %),
 *     pas le blanc de la ref. : sur notre écran la carte flotte au-dessus de
 *     la feuille, donc elle garde la teinte qui la rattache à la matière ;
 *   - sans bordure ni ombre, comme le carrousel (sa bordure de 1 dp sur un
 *     aplat translucide se lirait comme un contour de découpe) ;
 *   - pas d'en-tête « Aperçu » : la carte centrée SEULE se lit comme un
 *     exemple, et la feuille n'a que trois sections titrées (nom/couleur/emoji).
 *
 * Sans emoji choisi, l'aperçu montre l'initiale — exactement ce que faisait
 * la carte de devoir (#161) plutôt qu'un disque vide. La date est celle du
 * jour, en motif court français ; le titre est factice (cf.
 * `PREVIEW_EVAL_TITLE`).
 */
@Composable
private fun SubjectPreview(subject: String, prefs: List<SubjectPrefs>, draft: SubjectDraft) {
    val hex = subjectPreviewHex(prefs, subject, draft.colorHex)
    // Repli `secondary` : la même encre que les lignes de note sans couleur
    // (`subjectInk` dans `GradesRows.kt`), jamais du noir inventé.
    val ink = subjectContent(hex) ?: MaterialTheme.colorScheme.secondary
    // Le nom passe par la convention de #138 : libellé saisi, sinon nom de la
    // matière en casse de phrase (« ALLEMAND LV2 » → « Allemand LV2 »).
    val label = subjectDisplayFr(draft.label.ifBlank { subject })
    val badge = draft.emoji.trim().takeIf { it.isNotEmpty() } ?: subjectInitial(subject)
    val zone = remember { ZoneId.systemDefault() }
    // Figé par composition : la date ne doit pas changer à chaque recomposition.
    val today = remember { System.currentTimeMillis() }
    // Partielle (12,6 < 20) donc variante CONTOUR ; le libellé passe par
    // `gradeValueLabel` (virgule française), jamais une chaîne posée ici.
    val previewGrade = GradeUi(
        id = "apercu",
        subject = subject,
        value = PREVIEW_GRADE_VALUE,
        scale = PREVIEW_GRADE_SCALE,
        coefficient = null,
        millis = today,
        classAverage = null,
        classMin = null,
        classMax = null,
        periodId = null,
        bonus = false,
        optional = false,
        label = null,
        teacher = null,
    )
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier.width(PREVIEW_CARD_WIDTH),
            shape = MaterialTheme.shapes.extraLarge,
            colors = CardDefaults.cardColors(
                containerColor = subjectCardTint(hex)
                    ?: MaterialTheme.colorScheme.surfaceVariant,
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Column(
                modifier = Modifier.padding(
                    horizontal = PREVIEW_CARD_PADDING_H,
                    vertical = PREVIEW_CARD_PADDING_V,
                ),
                verticalArrangement = Arrangement.spacedBy(PREVIEW_CARD_GAP),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(PREVIEW_CARD_GAP),
                ) {
                    Box(
                        modifier = Modifier
                            .size(PREVIEW_EMOJI_CHIP)
                            .clip(MaterialTheme.shapes.medium)
                            .background(
                                subjectCardTint(hex)?.copy(alpha = PREVIEW_EMOJI_ALPHA)
                                    ?: MaterialTheme.colorScheme.surfaceVariant,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = badge,
                            style = MaterialTheme.typography.bodyLarge.copy(
                                fontSize = PREVIEW_EMOJI_SIZE,
                                lineHeight = PREVIEW_EMOJI_LINE,
                            ),
                            // Décorative : le libellé de la matière est juste à
                            // côté, en toutes lettres — même règle que
                            // `SubjectEmojiChip`.
                            modifier = Modifier.clearAndSetSemantics { },
                        )
                    }
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyLarge,
                        color = ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = previewShortDate(today, zone),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
                Text(
                    text = PREVIEW_EVAL_TITLE,
                    // Titre du carrousel : 18 sp SEMIBOLD (même correction que
                    // sur ses cartes, cf. `GradesRecentCarousel`).
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                GradePill(
                    grade = previewGrade,
                    colorHex = hex,
                    ink = ink,
                    valueStyle = MaterialTheme.typography.displaySmall,
                )
            }
        }
    }
}

/** Date courte de l'aperçu (« 18 déc. ») : le jour courant, jamais inventé. */
private fun previewShortDate(millis: Long, zone: ZoneId): String = runCatching {
    PREVIEW_DATE_FMT.format(Instant.ofEpochMilli(millis).atZone(zone))
}.getOrElse { "" }

/**
 * Roue de couleurs : pastilles CIRCULAIRES, anneau blanc sur TOUTES et ombre
 * douce, coche sur la sélection.
 *
 * L'anneau est BLANC (pas la couleur de marque) parce que la pastille porte
 * déjà une couleur de matière : c'est le seul liseré qui reste lisible sur les
 * vingt couleurs, claires comme foncées. La ref. cercle chaque pastille de
 * blanc : la sélection se lit donc à l'ÉPAISSEUR de l'anneau (2 → 3 dp) ET à
 * la coche, jamais à la seule teinte — une couleur ne peut pas être le seul
 * signal d'un choix.
 *
 * La coche est GARDÉE (pas abandonnée au profit de l'anneau seul) : l'anneau
 * blanc sur fond blanc de feuille ne se lit que par l'ombre, donc un second
 * signal non chromatique reste nécessaire — et son encre reste MESURÉE
 * (`bestContentOn` : un blanc en dur sur une pastille jaune tomberait à 1.1:1).
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
                    // L'ombre POSE la silhouette (et rogne au cercle) : sans
                    // elle l'anneau blanc se noierait dans la feuille blanche.
                    .shadow(SWATCH_SHADOW, CircleShape)
                    .background(color)
                    .then(
                        if (isSelected) {
                            Modifier.border(SWATCH_RING, Color.White, CircleShape)
                        } else {
                            Modifier.border(SWATCH_RING_IDLE, Color.White, CircleShape)
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
 * Rangée d'emoji : disques SURFACE (blancs en thème clair) cerclés d'un filet,
 * la sélection sur fond TEINTÉ — comme la ref.
 *
 * Sélection = `secondaryContainer` (le vert pâle du thème), PAS la teinte de
 * la matière : la teinte suivrait le brouillon de couleur (un disque déjà
 * coloré + un emoji en couleur = deux aplats qui se battent), demanderait un
 * repli quand le brouillon est invalide, et varierait en sombre — le rôle du
 * thème est stable dans les deux. Non sélectionné = `surface` (le disque blanc
 * de la ref.) + filet `outlineVariant` (le rôle filet à 13 %, comme
 * `PapDivider`), qui le détache de la feuille sans le griser.
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
                    .background(
                        if (isSelected) {
                            MaterialTheme.colorScheme.secondaryContainer
                        } else {
                            MaterialTheme.colorScheme.surface
                        },
                    )
                    .then(
                        if (isSelected) {
                            Modifier
                        } else {
                            Modifier.border(
                                SWATCH_HAIRLINE,
                                MaterialTheme.colorScheme.outlineVariant,
                                CircleShape,
                            )
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

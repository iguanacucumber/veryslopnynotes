package fr.veryslopnynotes.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fr.veryslopnynotes.data.SubjectPrefs

// Sélecteurs et lignes de l'onglet Notes #139 : recherche, période, algorithme,
// carrousel « Nouvelles notes », sections par matière et lignes de note avec
// leur CONTEXTE DE CLASSE (moyenne, min, max, coefficient, bonus, facultatif,
// enseignant, commentaire) et l'INFLUENCE de la note sur la moyenne.
//
// Toute couleur vient de `PapillonTheme.kt` : la couleur de matière passe par
// `subjectStyle` (libellé/emoji/color des préférences matière) puis par
// `subjectContent` (−45 % en clair, +55 % en sombre : le seul pas qui repasse
// 4.5:1 sur les 20 couleurs dans les DEUX thèmes).
// Aucune couleur en dur, aucune chaîne en dur venue du serveur.

/**
 * Largeur d'une carte du carrousel : 200 dp, mesurée dans `ui/new/
 * CompactGrade.tsx`. AVANT c'était 190 — une valeur choisie, et une carte trop
 * étroite se voit d'un coup d'œil à côté d'une capture.
 */
private val RECENT_CARD_WIDTH = 200.dp

/** Écart entre deux BLOCS d'une carte du carrousel (`gap: 8` dans la source). */
private val RECENT_CARD_GAP = 8.dp

/** Écart entre deux CARTES du carrousel (`ItemSeparatorComponent`, 12). */
private val RECENT_CARD_SEPARATOR = 12.dp

/**
 * Marge horizontale des blocs DANS une carte du carrousel.
 *
 * #192 : la référence ne pose pas de `paddingHorizontal` sur la carte mais sur
 * chacun de ses trois blocs (14). On rend donc 14 sur chaque bloc, pas 14 sur la
 * carte — le résultat est le même en largeur et DIFFÈRENT si un jour un bloc
 * prend du poids (une valeur à trois chiffres).
 */
private val RECENT_CARD_PADDING_H = 14.dp

/**
 * Marge verticale d'une carte du carrousel (`paddingVertical: 12`).
 *
 * Elle est sur la CARTE et non sur les blocs, à l'inverse du 14 ci-dessus : la
 * source est asymétrique et on ne « corrige » pas une asymétrie relevée.
 */
private val RECENT_CARD_PADDING_V = 12.dp

/**
 * Écart entre deux lignes de texte DANS un bloc : 1 dp.
 *
 * La référence écrit `gap: 1` à quatre endroits différents (corps de la carte
 * moyenne, corps de la ligne de note, blocs de la carte compacte, List), tous à
 * 1. Une seule constante pour les quatre, et une seule ligne qui dit pourquoi :
 * ce n'est pas un oubli de mesure, c'est la mesure — et un 1 dp se voit d'un
 * coup d'œil s'il devient 4.
 */
private val STACK_GAP = 1.dp

/**
 * Écart entre deux SECTIONS matière : 6 dp.
 *
 * #192 : la source pose `marginTop: gapBefore` sur l'en-tête, avec `gap = 12`
 * par défaut, MAIS 6 sur le premier rang qui suit un `sectionTitle`. On retient
 * 6 : c'est la seule valeur que la source écrit DEUX fois dans cette zone, donc
 * la seule qui ne dépend pas d'un chemin non emprunté.
 */
private val SECTION_GAP = 6.dp

/** Écart entre l'emoji et le nom de matière dans un en-tête de section : 10 dp
 *  sur Android, 8 sur iOS (`List.tsx`). On garde la valeur de la plateforme
 *  visée ; le 8 est cité pour qu'on sache que l'écart est choisi. */
private val SECTION_TITLE_GAP = 10.dp

/**
 * Marge verticale de l'en-tête d'une section : 6 dp (`paddingVertical: 6` puis
 * `paddingBottom: 6` — les deux se cumulent en haut, donc 12 de haut et 6 de bas).
 */
private val SECTION_HEADER_PADDING_V = 6.dp

/**
 * Écart entre la moyenne de matière et son barème : 1 dp (`gap: 1` dans la
 * ligne `flexDirection: 'row'` de la référence).
 *
 * PAS [STACK_GAP] : les deux valent 1 dp, mais ils ne mesurent pas la même chose
 * — celui-ci est un écart HORIZONTAL entre deux nombres, pas un empilement.
 * Les fusionner rendrait la constante inexpliquée : on ne sait plus lequel des
 * deux usages elle désigne.
 */
private val SECTION_AVERAGE_GAP = 1.dp

/**
 * Écart entre l'en-tête de section et sa première rangée de notes : 6 dp
 * (`gapBefore: 6`, posé sur le premier rang qui suit un `sectionTitle`).
 */
private val SECTION_HEADER_GAP = 6.dp

/**
 * Marge verticale d'une ligne de note : 14 dp sur Android, 12 sur iOS
 * (`List.tsx`). On garde ANDROID : c'est la plateforme visée. Le 12 est cité pour
 * que l'écart soit voulu et non subi.
 */
private val GRADE_ROW_PADDING_V = 14.dp

/** Marge horizontale d'une ligne de note : 16 dp sur les deux plateformes. */
private val GRADE_ROW_PADDING_H = 16.dp

/** Écart entre le texte d'une ligne et sa note (`marginLeft: 16` du `trailing`). */
private val GRADE_ROW_TRAILING_GAP = 16.dp

/**
 * Écart entre deux RANGS d'une pile de notes : 4 dp.
 *
 * #192, c'est le SEUL espacement qu'Android met entre eux (`marginBottom: 4`).
 * Et c'est pourquoi il n'y a PAS de filet ici : la référence pose bien un
 * `separator` de 0,5 dp ENCREUSÉ de 16 dp, mais sous `Platform.OS === "ios"` —
 * sur Android il n'existe pas. Notre filet de 1 dp venait de `PapCard`, qui en
 * pose un sur toutes les cartes ; le remplacer par un filet de 0,5 dp créerait la
 * version iOS sur une plateforme qui n'en a pas.
 */
private val GRADE_ROW_GAP = 4.dp

/** Rayon des coins extrêmes d'une pile de notes (`isFirst`/`isLast` à 20). */
private const val GRADE_ROW_CORNER = 20

/**
 * Rayon des coins AU CONTACT d'un autre rang : 8 dp.
 *
 * La source n'écrit ce 8 que dans la branche Android
 * (`borderTopLeftRadius: isFirst ? 20 : 8`) ; sur iOS les coins du milieu ne sont
 * pas posés et le filet fait la séparation. Sur notre plateforme cible, 8 est la
 * valeur relevée.
 */
private const val GRADE_ROW_CORNER_INNER = 8

/**
 * Couleur du texte de note quand la matière n'a pas de couleur choisie : le rôle
 * `secondary` du thème, donc le même vert que [subjectContent] côté palette.
 *
 * #146 : le repli était `primary` (vert de marque #29947A), qui ne vaut que
 * 3.74:1 sur la surface et 3.45:1 sur la surface variante — sous le 4.5:1 du WCAG
 * AA pour un corps de texte, alors que ces libellés sont en 13 sp.
 * `secondary` (#237E68 en clair, le vert clair en sombre) tient 4.93:1 et
 * 6.53:1 : même teinte à l'œil, lisible en texte.
 */
@Composable
private fun subjectInk(hex: String?): Color =
    (hex?.let { subjectContent(it) }) ?: MaterialTheme.colorScheme.secondary

/**
 * Fond de carte matière du carrousel, ou la surface variante du thème quand la
 * matière n'a pas de couleur choisie.
 *
 * #192 : c'est un ALPHA à 8 % de la matière, pas le pastel opaque à 75 % vers le
 * blanc de [subjectSurface]. La référence écrit `subjectColor + '15'` — un aplat
 * translucide posé sur le fond de l'écran — là où nous peignions un aplat clair
 * calculé. Les deux ne se ressemblent pas : notre carte était plus CLAIRE que le
 * fond, la sienne est le fond TEINTÉ, donc elle se fond dans l'écran au lieu de
 * flotter dessus.
 *
 * `surfaceVariant` reste le repli : une matière sans couleur n'a pas de teinte à
 * reporter, et un aplat neutre est le seul rendu qui n'invente pas de matière.
 */
@Composable
private fun subjectCardColor(hex: String?): Color =
    (hex?.let { subjectCardTint(it) }) ?: MaterialTheme.colorScheme.surfaceVariant

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
                // Borné : un libellé d'algorithme est court, mais une puce qui
                // déborde de l'écran de chip fait sortir le choix suivant du
                // champ de vision (cf. `GradesChipRow`, défilable).
                label = {
                    Text(
                        text = algorithmChipLabel(algorithm),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
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
            label = { Text("Année", maxLines = 1, overflow = TextOverflow.Ellipsis) },
        )
        for (period in periods) {
            FilterChip(
                selected = period.id == selectedId,
                onClick = { onSelect(period.id) },
                // Le nom d'une tranche vient de l'établissement : borné à une
                // ligne, sinon une tranche au nom long pousse les autres hors
                // de la rangée défilable.
                label = { Text(period.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
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

/**
 * Sélecteur de période de la BARRE DU HAUT : une pastille cliquable qui porte
 * le nom de la période choisie, avec le chevron de la référence, et le menu
 * déroulant en dessous.
 *
 * #190 : la référence pose ce sélecteur dans l'en-tête (`AndroidHeaderMenu`
 * avec l'icône calendrier, chaque période en action de menu avec son étendue
 * en sous-titre). Nous avons la rangée de chips `GradesPeriodChips` — exacte
 * pour la Vie scolaire, qui n'a pas d'en-tête, mais fausse ici : le même
 * contrôle existait deux fois sur le même écran.
 *
 * La pastille est un `TextButton` et non une `IconButton` : elle DOIT porter
 * le nom de la période (« Trimestre 1 »), c'est elle qui dit ce qu'on regarde.
 * Une icône seule obligerait à deviner la période au label de l'écran — ce que
 * la référence refuse en faisant du nom le titre de l'écran.
 *
 * Le menu rend `periodLabel` (nom + étendue) comme la référence rend `title` +
 * `subtitle`. Sans période chargée, rien n'est rendu : une pastille qui
 * proposerait « Année » alors que le serveur n'a rien publié serait un choix
 * qui n'a pas lieu d'être, et la référence non plus n'affiche pas de sélecteur
 * tant que sa liste est vide.
 *
 * @param slot clé de route pour publier l'en-tête — c'est l'écran qui décide
 *   du contenu de SA barre, pas la barre qui le décide pour lui.
 *
 * PAS de `modifier` : la fonction ne rend RIEN (elle publie, elle ne dessine
 * pas), donc un `modifier` n'aurait nulle part où s'appliquer. Le garder
 * produisait un avertissement du compilateur et une promesse que rien
 * n'accomplit.
 */
@Composable
fun GradesPeriodHeaderButton(
    periods: List<PeriodUi>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    slot: PapHeaderSlot?,
    route: String,
) {
    val selected = periods.firstOrNull { it.id == selectedId }
    // La pastille EST le titre de l'écran chez la référence (« Semestre 1 » à
    // gauche, et le titre reprend la période). Nous gardons le titre dans la
    // barre et la pastille à gauche des deux : même information, une seule
    // fois à l'écran — donc on ne répète pas le nom dans les deux places.
    LaunchedEffect(periods, selectedId, slot, route) {
        slot?.publish(
            route,
            PapHeader(
                title = selected?.name,
                leading = if (periods.isEmpty()) {
                    null
                } else {
                    {
                        PapPeriodPill(
                            label = selected?.name ?: "Année",
                            periods = periods,
                            selectedId = selectedId,
                            onSelect = onSelect,
                        )
                    }
                },
            ),
        )
    }
}

/**
 * La pastille et son menu. Séparée de [GradesPeriodHeaderButton] parce que le
 * `LaunchedEffect` qui publie l'en-tête ne doit PAS être relancé quand le menu
 * s'ouvre : ici, seul l'état d'ouverture change.
 *
 * `null` = « Année » (aucun `periodId`), comme la rangée de chips : même
 * période « toutes », donc le même mode de lecture de l'état, d'un écran à
 * l'autre.
 */
@Composable
private fun PapPeriodPill(
    label: String,
    periods: List<PeriodUi>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) {
            Text(
                text = label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                // La pastille annonce la période choisie : c'est son étiquette,
                // donc elle n'est pas décorative (contrairement à l'icône d'un
                // onglet, dont le libellé est déjà sous l'icône).
                modifier = Modifier.semantics { contentDescription = "Période : $label" },
            )
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                // `contentDescription = null` : le nom est déjà dans le texte
                // de la pastille, l'annoncer en plus le ferait dire deux fois.
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        PapPeriodMenu(
            expanded = open,
            periods = periods,
            selectedId = selectedId,
            onSelect = { onSelect(it); open = false },
            onDismiss = { open = false },
        )
    }
}

/**
 * Menu des périodes. Chaque entrée porte le nom PUIS l'étendue (deux lignes),
 * comme les actions de menu de la référence (titre + sous-titre).
 */
@Composable
private fun PapPeriodMenu(
    expanded: Boolean,
    periods: List<PeriodUi>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text("Année") },
            onClick = { onSelect(null) },
        )
        for (period in periods) {
            DropdownMenuItem(
                text = {
                    Column {
                        Text(
                            text = period.name,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            // L'étendue est une PRÉCISION de la période, pas un
                            // choix : la ligne entière l'annonce, donc le nom
                            // seul se lit à voix haute, et les deux se lisent à
                            // l'œil.
                            modifier = Modifier.semantics(mergeDescendants = true) {},
                        )
                        Text(
                            text = periodRange(period),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                // L'entrée choisie est marquée, sinon le menu ne dit pas où on
                // est — la référence passe son état par `state: 'on'`.
                trailingIcon = {
                    if (period.id == selectedId) {
                        Icon(imageVector = Icons.Filled.Check, contentDescription = null)
                    }
                },
                onClick = { onSelect(period.id) },
            )
        }
    }
}

/** Étendue d'une période seule (« 01/09/2026 – 05/01/2027 »), sans son nom. */
fun periodRange(period: PeriodUi): String =
    periodLabel(period).substringAfter("· ", period.name)

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
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
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
        // #192 : 12 dp entre les cartes. AVANT c'était 12 aussi, mais à
        // l'INTÉRIEUR de la carte qu'on mettait 4 dp : l'écart visible entre
        // deux cartes était donc le bon, et la respiration interne la mauvaise.
        horizontalArrangement = Arrangement.spacedBy(RECENT_CARD_SEPARATOR),
    ) {
        for (grade in grades) {
            val style = subjectStyle(prefs, grade.subject)
            val ink = subjectInk(style.colorHex)
            // #192 : rayon 24 et fond TRANSLUCIDE à 8 % (`subjectColor + '15'`).
            // Le rayon était 20 (notre `shapes.large`) ; le fond était le pastel
            // opaque à 75 % vers le blanc, qui est une autre couleur — voir
            // [SUBJECT_CARD_ALPHA].
            //
            // On ne rejoue PAS le `GlassContainer` : c'est le verre liquide d'iOS
            // 26, absent sur Android (le `backgroundColor` y est écrit en dur,
            // cf. la branche `Platform.OS === 'ios'` de `CompactGrade.tsx`). Un
            // fond translucide posé SUR une carte, elle-même translucide, n'a
            // pas d'équivalent Material — donc la carte est opaque et tinted.
            Card(
                modifier = Modifier
                    .width(RECENT_CARD_WIDTH)
                    .clip(MaterialTheme.shapes.extraLarge),
                shape = MaterialTheme.shapes.extraLarge,
                colors = CardDefaults.cardColors(
                    containerColor = subjectCardColor(style.colorHex),
                ),
                // Ni bordure ni ombre : la carte de la référence n'en a pas (son
                // ombre est la valeur par défaut d'iOS, sans effet ici), et une
                // bordure de 1 dp sur un aplat translucide se lit comme un
                // contour de découpe.
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Column(
                    modifier = Modifier.padding(vertical = RECENT_CARD_PADDING_V),
                    verticalArrangement = Arrangement.spacedBy(RECENT_CARD_GAP),
                ) {
                    // Bloc 1 : emoji + nom de la matière, sur UNE ligne. AVANT,
                    // l'emoji était dans un PASTILLE ARRONDIE de 44 dp
                    // (`PapSubjectAvatar`) et le nom passait à la ligne en
                    // dessous : deux blocs là où la référence en a un.
                    Row(
                        modifier = Modifier.padding(horizontal = RECENT_CARD_PADDING_H),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(RECENT_CARD_GAP),
                    ) {
                        if (!style.emoji.isNullOrEmpty()) {
                            Text(
                                text = style.emoji,
                                // 18/25 relevé sur la source, en surcharge
                                // INLINE d'un `body1` — donc la famille de
                                // `body1`, pas celle d'un titre. Aucun style du
                                // thème ne porte ce couple, on l'écrit.
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    fontSize = 18.sp,
                                    lineHeight = 25.sp,
                                ),
                                // Décoratif : le nom de la matière est juste à
                                // côté, en toutes lettres.
                                modifier = Modifier.clearAndSetSemantics { },
                            )
                        }
                        Text(
                            text = style.label,
                            // `body1` de la référence : 15 sp. NOTRE
                            // `labelMedium` (13 sp, la taille d'un libellé
                            // d'onglet) faisait du nom de matière une étiquette.
                            style = MaterialTheme.typography.bodyLarge,
                            color = ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    // Bloc 2 : libellé de l'évaluation + date relative.
                    Column(
                        modifier = Modifier.padding(horizontal = RECENT_CARD_PADDING_H),
                        verticalArrangement = Arrangement.spacedBy(RECENT_CARD_GAP),
                    ) {
                        // #192 : une évaluation SANS libellé publié ne laisse
                        // plus une LIGNE VIDE. Avant c'était `grade.label
                        // .orEmpty()`, donc un `Text` vide qui prenait quand même
                        // sa hauteur — visible sur la capture comme un trou entre
                        // le nom de la matière et la date. La référence rend un
                        // REPLI (« Devoir de <matière> ») ; on rend la même idée
                        // avec notre libellé de matière préféré, parce que le
                        // nom du contrat peut être une abréviation illisible et
                        // que la carte est le seul endroit où les deux se
                        // suivent.
                        //
                        // Donc on n'écrit plus `grade.label` seul : sans lui, le
                        // repli ne se déclenche pas.
                        Text(
                            text = grade.label?.takeIf { it.isNotBlank() }
                                ?: "Devoir de ${style.label}",
                            // `title` de la référence : 18 sp SEMIBOLD sur
                            // Android. `titleLarge` est 18 gras chez nous, donc
                            // même correction que sur la carte moyenne : on retire
                            // le gras au lieu de créer un style.
                            style = MaterialTheme.typography.titleLarge.copy(
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = relativeTimeFr(grade.millis, nowMillis),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    // Bloc 3 : la note, alignée en bas.
                    GradeValue(
                        grade = grade,
                        ink = ink,
                        valueStyle = MaterialTheme.typography.displaySmall,
                        modifier = Modifier.padding(horizontal = RECENT_CARD_PADDING_H),
                    )
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
) {
    // #192 : le `modifier` de l'appelant ne va plus sur le `Column` de CHAQUE
    // section. Avant, il était recopié sur chaque section — donc un `padding`
    // du parent se cumulerait une fois par matière, et la première section
    // serait la seule correctement positionnée. Il va sur le `Column` unique
    // qui porte les sections, avec l'espacement entre sections que la
    // référence pose sur chaque en-tête (`marginTop: gapBefore`, 12).
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(SECTION_GAP),
    ) {
        for (group in groups) {
            val style = subjectStyle(prefs, group.subject)
            Column(verticalArrangement = Arrangement.spacedBy(SECTION_HEADER_GAP)) {
                // #192 : l'en-tête porte sa propre marge verticale — relevée dans
                // `List.tsx` : `paddingVertical: 6` puis `paddingBottom: 6`, et
                // `gap: 10` (8 sur iOS).
                //
                // La marge HORIZONTALE de 16 dp que la source pose sur l'en-tête
                // n'est PAS remise ici : elle joue le rôle du `padding` de 16 dp
                // du `Column` de l'écran, et notre ligne de note applique le sien
                // à l'intérieur du fond de la rangée. Doubler les deux donnerait
                // 32 dp d'un côté et 16 de l'autre — donc un en-tête désaligné du
                // texte qu'il nomme, ce qui est pire que l'inverse.
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        // 2 dp de la rangée de la référence, PLUS les 6 du
                        // conteneur : son en-tête porte les deux. Ici le conteneur
                        // c'est l'écart du `Column` ([SECTION_HEADER_GAP]), donc on
                        // ne les cumule pas deux fois — on garde 6, la valeur que
                        // la source écrit DEUX fois dans cette zone.
                        .padding(vertical = SECTION_HEADER_PADDING_V),
                    // `alignItems: 'center'` sur la rangée, mais `flex-end` sur la
                    // ligne moyenne + barème : le centre s'applique à l'ENSEMBLE,
                    // donc l'alignement de la moyenne est le sien.
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(SECTION_TITLE_GAP),
                ) {
                    // Décoratif : le libellé de la matière est juste à côté, en
                    // toutes lettres. `#146` — sans ça, TalkBack annonçait le nom de
                    // l'emoji puis le libellé, donc deux fois la même information.
                    if (!style.emoji.isNullOrEmpty()) {
                        Text(
                            text = style.emoji,
                            // `h4` de la référence : 21 sp. `headlineLarge` EST
                            // ce 21 dans notre échelle — `titleMedium` (17) le
                            // sous-dimensionnait d'un cran.
                            style = MaterialTheme.typography.headlineLarge,
                            modifier = Modifier.clearAndSetSemantics { },
                        )
                    }
                    // Titre de section par matière : `heading()`, sinon une note
                    // d'antimatière ne se trouve pas au survol de l'écran.
                    Text(
                        text = style.label,
                        // `title` semibold de la référence : 18 sp SEMIBOLD
                        // (même correction que sur la carte moyenne).
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false).semantics { heading() },
                    )
                    // #192 : la moyenne et son dénominateur sont DEUX `Text`
                    // SUR UNE LIGNE, `h5` (19) puis `caption` (13), alignés en
                    // bas et séparés de 1 dp — c'est ce que pose la référence
                    // (`flexDirection: 'row', alignItems: 'flex-end', gap: 1`).
                    //
                    // AVANT c'était UNE chaîne « 14,87 · 3 notes » en
                    // `titleSmall` (14) : la moyenne ne se détachait pas du
                    // compte, et un compteur inventé (« 3 notes ») s'y melait à un
                    // nombre qu'on ne peut pas inventer.
                    // Sans moyenne publiée, on ne rend RIEN à droite — pas un
                    // tiret, pas un « /20 », et surtout pas deux `Text` VIDES :
                    // un `Text` vide occupe quand même la hauteur de son
                    // interligne, donc il laisserait un trou de 19 sp à droite du
                    // nom de la matière. La référence conditionne de même son
                    // rendu sur `denominator !== ''`.
                    if (group.average != null) {
                        Row(
                            verticalAlignment = Alignment.Bottom,
                            horizontalArrangement = Arrangement.spacedBy(SECTION_AVERAGE_GAP),
                        ) {
                            Text(
                                text = subjectAverageValue(group),
                                // `h5` de la référence : 19 sp. `headlineMedium`
                                // EST ce 19 dans notre échelle.
                                style = MaterialTheme.typography.headlineMedium,
                                // La moyenne d'une matière est POSITIVE par
                                // nature — une moyenne baisse, elle n'est jamais
                                // négative. Donc `secondary` (4.93:1 sur la surface
                                // variante) est ici un choix de LECTURE, pas un
                                // pis-aller : le vert se lit « ça va », et le
                                // nombre reste dans le texte.
                                color = MaterialTheme.colorScheme.secondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = subjectAverageScale(group),
                                // `caption` de la référence : 13 sp + 0,1 sp
                                // d'interlettrage — exactement notre `bodySmall`.
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                // #192 : la position dans la pile décide de la FORME (cf.
                // [gradeRowShape]) et de l'espace en dessous. On indexe donc
                // réellement la liste, au lieu de supposer que la dernière
                // itération est la dernière — ce qui serait faux dès qu'un
                // filtre en retire une.
            // #192 : la position dans la pile décide de la forme (cf.
            // [gradeRowShape]) et de l'espace en dessous. On indexe donc
            // réellement la liste, au lieu de supposer que la dernière itération
            // est la dernière — ce qui serait faux dès qu'un filtre en retire
            // une.
                val lastIndex = group.grades.lastIndex
                for ((index, grade) in group.grades.withIndex()) {
                    GradeRow(
                        grade = grade,
                        prefs = prefs,
                        influence = influenceOf(influences, grade.id),
                        first = index == 0,
                        last = index == lastIndex,
                    )
                }
            }
        }
    }
}

/**
 * Valeur de la moyenne de matière (« 14,87 »), ou une chaîne VIDE quand
 * l'établissement n'en publie pas.
 *
 * Vide et non « — » : la référence conditionne son rendu sur
 * `subjectAverage.denominator !== ''`, donc une moyenne absente ne laisse RIEN à
 * droite du nom de la matière — pas un tiret, pas un 0.
 */
private fun subjectAverageValue(group: GradeGroupUi): String =
    group.average?.let { formatMark(it) }.orEmpty()

/**
 * Dénominateur de la moyenne, à DROITE de la valeur : le BARÈME (« /20 »), pas
 * un compte de notes.
 *
 * #192 : avant, c'était « 3 notes » dans la MÊME chaîne que la moyenne. Le
 * compte était une information que nous inventions — l'établissement publie un
 * barème, il ne publie pas combien de notes ont servi à la moyenner. Le
 * dénominateur que la référence affiche est le sien, donc le nôtre est le
 * nôtre : [AVERAGE_SCALE], le barème du contrat.
 *
 * Une chaîne vide si le barème est illisible : même règle que la valeur, donc
 * le même rendu (rien) plutôt qu'un « /0 ».
 */
private fun subjectAverageScale(group: GradeGroupUi): String =
    if (group.average == null) "" else scaleSuffix(AVERAGE_SCALE)

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
    // #192 : la ligne est un RANG D'UN EMPILEMENT, pas une carte : la référence
    // n'arrondit que les coins EXTREMES de la pile (20 en haut, 20 en bas) et
    // laisse les coins du milieu à 8 dp, avec 4 dp d'espace entre les rangs.
    // Donc ces deux drapeaux ne sont pas du style : ils portent la FORME, et
    // c'est ce qui distingue « une pile de notes » de « N cartes empilées ».
    first: Boolean = true,
    last: Boolean = true,
) {
    val style = subjectStyle(prefs, grade.subject)
    val ink = subjectInk(style.colorHex)
    Card(
        modifier = modifier
            .fillMaxWidth()
            // Le fond est porté par le RANG, pas par la pile : chez la
            // référence c'est `colors.item` sur chaque `rowContainer`.
            .padding(bottom = if (last) 0.dp else GRADE_ROW_GAP),
        shape = gradeRowShape(first = first, last = last),
        // Ni bordure ni filet : la référence n'en pose pas sur Android, où il
        // n'y a MÊME pas de séparateur entre les rangs (le `separator` de 0,5 dp
        // est sous `Platform.OS === "ios"`). Notre filet de 1 dp faisait une
        // grille de cartes là où la référence fait une pile.
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier.padding(
                // 14 dp sur Android (12 sur iOS) et 16 dp sur les deux côtés —
                // relevés dans `List.tsx`. AVANT c'était le padding de carte
                // (16 dp sur les quatre côtés), donc les lignes respiraient 2 dp
                // de moins en haut et en bas, et leur texte collait à la bordure.
                vertical = GRADE_ROW_PADDING_V,
                horizontal = GRADE_ROW_PADDING_H,
            ),
            verticalAlignment = Alignment.CenterVertically,
            // La référence pose un `marginLeft: 16` sur la zone de droite, pas un
            // `gap` : l'écart se lit donc entre le texte et la note, et non
            // entre deux zones égales.
            horizontalArrangement = Arrangement.spacedBy(GRADE_ROW_TRAILING_GAP),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(STACK_GAP),
            ) {
                // `label` est le commentaire libre de l'enseignant, borné
                // par le CONTRAT à 200 caractères : deux lignes suffisent à
                // dire de quoi il s'agit, la carte entière reste lisible.
                Text(
                    text = gradeLabel(grade),
                    // `title` semibold de la référence = 18 sp SEMIBOLD.
                    // `titleSmall` (14 sp) était la taille d'un libellé de
                    // navigation : le titre d'une note ne se lisait pas comme un
                    // titre.
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    // #192 : date EN TOUTES LETTRES, plus « il y a 3 jours » —
                    // voir [longDateFr]. Le paramètre `nowMillis` n'est donc plus
                    // nécessaire ici, et l'horloge ne décide plus de ce qu'on lit.
                    text = longDateFr(grade.millis),
                    // La référence écrit `variant="subtitle"`, qui N'EXISTE PAS
                    // dans son échelle : le rendu retombe silencieusement sur
                    // `body1` (15 sp). On rend ce qu'elle rend, donc `bodyLarge`.
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                // ÉCART ÉCRIT — DONNÉE QUE LA RÉFÉRENCE N'A PAS. Coefficient,
                // bonus, facultatif, enseignant, moyenne de classe et influence
                // n'existent pas dans son type `Grade` (ni le champ, ni le
                // rendu) : nous les avons au contrat et ils sont utiles à une
                // moyenne. Les retirer alignerait la ligne sur la référence en
                // supprimant une feature — donc on garde, et on l'écrit.
                val context = gradeContextLabel(grade)
                if (context.isNotEmpty()) {
                    Text(
                        text = context,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (influence != null) {
                    // `primary` (3.74:1) et `error` (3.70:1 en thème sombre) ne
                    // passent pas AA en 13 sp : l'accroissance prend `secondary`
                    // (4.93:1) et la baisse l'encre d'erreur du thème
                    // ([errorTextColor], 8.52:1 sur la surface variante en sombre).
                    // Le SIGNE reste dans le texte (« +0,4 » / « −0,3 ») : la couleur
                    // ne porte jamais l'information seule.
                    Text(
                        text = influenceLabel(influence.impact),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (influence.impact > 0) {
                            MaterialTheme.colorScheme.secondary
                        } else {
                            errorTextColor()
                        },
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            GradeValue(
                grade = grade,
                ink = ink,
                // `h4` de la référence = 21 sp ; `headlineMedium` est ce 21 dans
                // notre échelle.
                valueStyle = MaterialTheme.typography.headlineMedium,
            )
        }
    }
}

/**
 * Forme d'un rang de pile : coins à 20 dp en haut ET en bas s'il est seul, à 20
 * dp en haut s'il ouvre la pile, à 20 dp en bas s'il la ferme, et 8 dp aux coins
 * qui sont au contact d'un autre rang.
 *
 * #192 : c'est le seul endroit du codebase où la forme d'un composant dépend de
 * sa POSITION, et c'est mesuré : `List.tsx` arrondit `first`/`last` à 20 et
 * laisse les coins « milieu » à 8 — 8 n'étant écrit que sous
 * `Platform.OS === "android"`.
 */
private fun gradeRowShape(first: Boolean, last: Boolean): RoundedCornerShape =
    RoundedCornerShape(
        topStart = if (first) GRADE_ROW_CORNER.dp else GRADE_ROW_CORNER_INNER.dp,
        topEnd = if (first) GRADE_ROW_CORNER.dp else GRADE_ROW_CORNER_INNER.dp,
        bottomStart = if (last) GRADE_ROW_CORNER.dp else GRADE_ROW_CORNER_INNER.dp,
        bottomEnd = if (last) GRADE_ROW_CORNER.dp else GRADE_ROW_CORNER_INNER.dp,
    )

/**
 * La note : grand nombre dans la couleur de la matière, barème petit et gris.
 * Une note hors /20 affiche son BARÈME RÉEL (`/10`, `/15`) : jamais un « /20 »
 * inventé pour une évaluation notée sur une autre échelle.
 */
/**
 * La note : le nombre dans la couleur de la matière, son barème en petit gris.
 *
 * Une note hors /20 affiche son BARÈME RÉEL (`/10`, `/15`) : jamais un « /20 »
 * inventé pour une évaluation notée sur une autre échelle.
 *
 * #192 : [valueStyle] est un paramètre parce que la note n'a pas la même taille
 * partout — `h3` (24) sur une carte du carrousel, `h4` (21) sur une ligne de
 * pile. Avant c'était `headlineMedium` (21) PARTOUT, donc la carte du carrousel
 * montrait une note plus petite que la ligne en dessous d'elle.
 *
 * [modifier] va sur la `Row` entière, pas sur le nombre : le bloc de la
 * référence porte le `paddingHorizontal` sur sa Rangée (valeur + dénominateur
 * ensemble), donc un padding appliqué au seul nombre décalerait le barème.
 */
@Composable
private fun GradeValue(
    grade: GradeUi,
    ink: Color,
    valueStyle: TextStyle,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = gradeValueLabel(grade.value),
            style = valueStyle,
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = scaleSuffix(grade.scale),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
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
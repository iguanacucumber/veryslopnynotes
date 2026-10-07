package fr.veryslopnynotes.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.ZoneId

// CARTE DE COURS #137 — la pièce qui manquait à l'EDT.
//
// AVANT, l'onglet EDT rendait une chaîne par cours : « Maths-Fake • Salle A12
// • Mme X • 08:00-09:00 », tout en encre de matière sur fond blanc. La couleur
// des `SubjectPrefs` ne fournissait qu'une teinte de texte (et, pour un cours
// annulé, un `Color.LightGray` à 1.5:1 — cf. #134). Une carte n'est pas une
// chaîne : c'est une PASTELLE de matière, une colonne vertébrale de la couleur
// franche à gauche, un nom de matière en gras, et une ligne de méta qui se lit
// d'un coup d'œil — c'est la forme de papillon.bzh, relevée sur l'app.
//
// Les couleurs ne sont pas des hex posés ici : le fond vient de
// `subjectSurface` (le pastel de matière), l'encre de `subjectContent` (le pas
// mesuré qui repasse 4.5:1 sur les 20 couleurs), la colonne de `colorFromHex`
// (la couleur de matière elle-même), et l'annulé du rôle `error` passé par le
// MÊME [tint] que tout le reste du thème. Aucune couleur en dur, donc le mode
// sombre est correct sans une seconde feuille de style.
//
// ponytail: `Restaurant` (la fourchette et le couteau) est dans
// `material-icons-extended`, et la liste des modules Gradle de `ui` est FIGÉE
// par un garde-fou : 10 000 icônes pour un glyphe, non. Le pictogramme est donc
// DESSINÉ (onze traits), ce qui le rend monochrome et teintable comme les
// `ImageVector` du thème. Upgrade: si le BOM avance et qu'`Icons.Filled.*`
// s'élargit, cette fonction devient une ligne — rien d'autre ne change.

/**
 * Épaisseur de la barre d'accent : le seul élément NON pastel d'une carte. C'est
 * elle qui rend la matière identifiable d'un coup d'œil, le fond pastel seul ne
 * donnant qu'une teinte.
 *
 * #194 : 6 dp était DÉJÀ la valeur de la référence. On le note parce que c'est
 * la seule mesure de cette vague qui était juste avant — donc celle qui sert de
 * témoin : si les autres dérivent, celle-ci doit être la preuve qu'on n'a pas
 * tout décalé d'un cran.
 */
private val SPINE_WIDTH = 6.dp

/** Gouttière de temps : 60 dp, relevé dans `renderTimes` (`width: 60`). */
val TimetableTimeGutterWidth = 60.dp

/**
 * Rayon de la carte de cours : 25 dp.
 *
 * #194 : c'était `shapes.large` (20). La référence pose `borderRadius: 25`, ou
 * `18` pour sa variante COMPACTE — variante qui existe et n'est pas rare : le
 * widget d'accueil de l'onglet Accueil l'active (`compact={true}`). On prend 25
 * quand même, parce que l'onglet Cours est une liste de fiches, pas un widget :
 * la variante compacte est faite pour tenir dans une carte d'accueil, et ses
 * 12 dp de padding feraient ici une fiche à bout de souffle.
 *
 * PAS `shapes.extraLarge` (24) : ce serait arrondi au plus proche, donc « presque
 * la valeur de la référence ». Un rayon n'est pas une durée de transition — il
 * se voit exactement ou pas du tout.
 */
private val CARD_RADIUS = 25.dp

/** Filet d'1 dp (bordure de carte, séparateur de méta). */
private val HAIRLINE = 1.dp

/** Bordure du cours mis en avant : 2 dp pour « en cours », 1 dp pour « suivant ». */
private val CURRENT_BORDER = 2.dp

/**
 * Espacement interne d'une carte : **14 dp sur les quatre côtés**, posé sur le
 * CONTENEUR qui porte la barre d'accent — donc la barre est encastrée de 14 dp
 * dans la carte, et le texte a de la marge des deux côtés.
 *
 * #194 : c'était 12 en horizontal sur la seule colonne de texte, et 10 en
 * vertical. Deux défauts distincts : la barre d'accent était COLLÉE au bord
 * gauche de la carte (elle se confondait avec le bord, et son rayon ne se
 * voyait pas), et le texte n'avait AUCUNE marge à droite.
 */
private val CARD_PADDING_H = 14.dp
private val CARD_PADDING_V = 14.dp

/**
 * Écart entre la barre d'accent et le texte : **10 dp** (`gap={10}` autour du
 * `<Stack direction="horizontal">` qui porte accent + contenu).
 *
 * AVANT, cet écart était le padding horizontal de la colonne de texte (12 dp) —
 * donc il n'existait pas comme mesure : il était un effet de bord du padding.
 * Séparer les deux veut dire qu'un jour où le padding change, l'accent reste à
 * sa place.
 */
private val SPINE_GAP = 10.dp

/** Écart entre la gouttière d'heures et la carte : **12 dp** (`gap: 12`). */
val TimetableRowGap = 12.dp

/**
 * Écart VERTICAL entre deux cartes : **10 dp**, et c'est 4 + 6.
 *
 * #194 : la source pose `gap: 4` dans le `contentContainerStyle` de la
 * `FlatList`, ET `marginBottom: 6` sur chaque `Course`. Donc 10, pas 4 : le seul
 * qui compte est celui qu'on voit.
 */
val TimetableCardGap = 10.dp

/** Marge horizontale de la page de jour : **12 dp** (`SafeHorizontalView base={12}`). */
val TimetablePagePadding = 12.dp

/** Écart entre les deux lignes de la gouttière d'heures : 3 dp (`gap={3}`). */
private val TIME_GUTTER_GAP = 3.dp

/**
 * Interligne de l'heure de DÉBUT : **20 sp**, contre les 32 que déclare son
 * `h5`. C'est un `TextUnit` et non un `Dp` : un interligne est une hauteur de
 * ligne de texte, pas une distance entre deux blocs.
 */
private val TIME_START_LEADING = 20.sp

/** Interligne de l'heure de FIN : **19 sp** (son `body2`). */
private val TIME_END_LEADING = 19.sp

/** Écart entre les deux icônes de méta et leur texte : 5 dp. */
private val META_ICON_GAP = 5.dp

/** Écart entre deux lignes d'une carte de cours : 2 dp (`gap: 2`). */
private val STACK_GAP = 2.dp

/** Écart vertical entre le nom du cours et la ligne salle/professeur : 1 dp. */
private val META_LINE_GAP = 1.dp

/**
 * Côte du pictogramme de la bande de pause : **24 dp** (`size={24}`).
 *
 * C'était 18 dp — la taille d'un glyphe d'icône. Ici l'icône est à la taille
 * du texte qu'elle accompagne, et pose l'égalité des deux dans la bande.
 */
private val CUTLERY_SIZE = 24.dp

/** Unités du carré de dessin du pictogramme (20 × 20). */
private const val CUTLERY_UNITS = 20f

/** En dessous de cette luminance de surface, l'écran est en thème SOMBRE : les
 *  aplats clairs (un cours annulé, rouge pâle) y brûlent la lecture. */
private const val DARK_SURFACE_LUMINANCE = 0.5f

/** Marge verticale de la bande de pause : 8 dp (`padding={[14, 8]}`). */
private val LUNCH_PADDING_V = 8.dp

/** Opacité de l'icône et du libellé de la bande de pause : 0,6 (`opacity: 0.6`). */
private const val LUNCH_ALPHA = 0.6f

/** Opacité de la DURÉE de la bande de pause : 0,5 (`colors.text + "80"`). */
private const val LUNCH_DURATION_ALPHA = 0.5f

/**
 * Côte d'une icône de méta : **20 dp**.
 *
 * #194 : c'était 14 dp, taille de glyphe. La référence rend un `<Icon papicon
 * size={20}>` — donc 20, dans la même unité que le texte qu'il accompagne. À 14,
 * l'icône de salle était visiblement plus petite que les mots qu'elle précédait,
 * et la ligne de méta se lisait comme deux mots sans pictogramme.
 */
private val META_ICON = 20.dp

/**
 * Séparateur entre la salle et le professeur : **2 × 20 dp, rayon 50, 50 %
 * d'opacité**, avec 8 dp de marge de chaque côté.
 *
 * #194 : c'était un `VerticalDivider` de 1 × 12 dp à 24 %. Un filet de 1 dp est
 * une HAIRLINE d'écran — à cette taille de texte il disparaît, alors qu'un trait
 * de 2 dp se lit. L'opacité passe de 0,24 à 0,5 : le trait est décoratif, donc
 * aucune règle de contraste ne lui s'applique, et 0,5 est ce que la source écrit.
 */
private val META_DIVIDER_WIDTH = 2.dp
private val META_DIVIDER_HEIGHT = 20.dp
private const val META_DIVIDER_ALPHA = 0.5f

/** Marge de chaque côté du séparateur de méta. */
private val META_DIVIDER_MARGIN = 8.dp

/** Marge à droite de la gouttière d'heures : 2 dp (`paddingRight: 2`). */
private val TIME_GUTTER_PADDING_END = 2.dp

private const val CANCELLED_LABEL = "Annulé"
private const val CURRENT_LABEL = "En cours"
private const val NEXT_LABEL = "Prochain"

/**
 * Fond d'un cours annulé : le rouge de marqueclairci à 82 % — c'est le
 * « rouge pâle » de l'app de référence, et non un hex recopié — et le MÊME rouge
 * assombri à −60 % quand la surface est sombre.
 *
 * Un aplat rouge pâle sur fond blanc mesure 1.5:1 avec le rouge du thème en
 * texte : c'est pour ça que l'encre d'un cours annulé n'est PAS `error` mais
 * [cancelledInk]. Cf. le miroir `tests/unit/android-timetable.test.ts`.
 */
fun cancelledSurface(error: Color, dark: Boolean): Color = tint(error, if (dark) -.60f else .82f)

/**
 * Encre d'un cours annulé : le rouge de la marque poussé dans la même direction
 * que l'encre d'une carte matière (`tint` à −45 %, le pas mesuré qui repasse
 * 4.5:1 sur toute la palette) en thème clair, éclairci à 72 % en thème sombre.
 *
 * Mesuré sur le fond [cancelledSurface] : 7.3:1 en clair, 8.9:1 en sombre.
 */
fun cancelledInk(error: Color, dark: Boolean): Color = tint(error, if (dark) .72f else -.45f)

/** L'écran est-il en thème sombre ? Le fond DU THÈME en décide — pas d'un
 *  réglage lu ailleurs, donc pas de désynchronisation possible. */
@Composable
fun isDarkSurface(): Boolean =
    relativeLuminance(MaterialTheme.colorScheme.surface) < DARK_SURFACE_LUMINANCE

/**
 * Carte d'un cours : gouttière de temps puis carte de matière.
 *
 * [label] est le libellé résolu par `SubjectStyle` (nom de matière ou libellé
 * perso, emoji compris), [colorHex] la couleur de matière (`#RRGGBB`, déjà
 * validée : venue des `SubjectPrefs` ou de la palette du thème). Les deux sont
 * calculées par l'écran — cette carte ne lit ni prefs ni dépôt.
 *
 * [highlight] encadre le cours en cours (2 dp) et signale le suivant (1 dp) :
 * c'est le seul état que la carte ajoute au statut du cours (annulé, déplacé),
 * qui se lit sur le texte.
 *
 * #145 : le cours EN COURS pulse en plus (échelle 1 -> 1.02, opacité qui descend
 * juste assez pour lire un battement). Le filet de 2 dp disait QUEL cours, jamais
 * CE MOMENT-LÀ — or c'est la question que l'onglet EDT sert. La pulsation est
 * coupée avec le reste quand le téléphone a désactivé les animations.
 */
@Composable
fun PapCourseCard(
    lesson: TimetableLessonUi,
    label: String,
    colorHex: String,
    zone: ZoneId,
    modifier: Modifier = Modifier,
    highlight: CourseHighlight = CourseHighlight.NONE,
) {
    val dark = isDarkSurface()
    val error = MaterialTheme.colorScheme.error
    val cancelled = lesson.isCancelled()
    // Repli `?: MaterialTheme…` : une couleur illisible ne doit pas laisser une
    // carte TRANSPARENTE (on ne verrait plus que le texte).
    val background = if (cancelled) {
        cancelledSurface(error, dark)
    } else {
        subjectSurface(colorHex) ?: MaterialTheme.colorScheme.surfaceVariant
    }
    val ink = if (cancelled) {
        cancelledInk(error, dark)
    } else {
        subjectContent(colorHex) ?: MaterialTheme.colorScheme.onSurface
    }
    val spine = if (cancelled) error else colorFromHex(colorHex) ?: MaterialTheme.colorScheme.primary
    Card(
        modifier = modifier.papCurrentPulse(highlight == CourseHighlight.CURRENT),
        shape = RoundedCornerShape(CARD_RADIUS),
        colors = CardDefaults.cardColors(containerColor = background),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = when (highlight) {
            CourseHighlight.CURRENT -> BorderStroke(CURRENT_BORDER, spine)
            CourseHighlight.NEXT -> BorderStroke(HAIRLINE, spine)
            CourseHighlight.NONE -> null
        },
    ) {
        // `IntrinsicSize.Min` : la barre d'accent doit porter TOUTE la hauteur
        // de la carte, donc la Row se mesure à la hauteur de son plus haut enfant.
        Row(
            modifier = Modifier
                .height(IntrinsicSize.Min)
                // #194 : le padding 14 est sur le CONTENEUR, pas sur la colonne
                // de texte — donc la barre d'accent est ENCASTRÉE de 14 dp dans
                // la carte, et non collée à son bord gauche.
                //
                // C'est le geste qui rend la barre lisible : collée au bord, elle
                // se confond avec le filet de la carte ; encastrée, elle flotte,
                // et son rayon 300 se voit. AVANT, notre barre était collée au bord
                // et le texte n'avait de marge qu'à gauche (par le padding de la
                // colonne) — donc rien à droite non plus.
                .padding(horizontal = CARD_PADDING_H, vertical = CARD_PADDING_V),
            // 10 dp entre la barre et le texte (`gap={10}`) : un écart à part,
            // pas le padding. Avant c'était le padding horizontal de la colonne —
            // donc il n'existait pas comme mesure, il était un effet de bord.
            horizontalArrangement = Arrangement.spacedBy(SPINE_GAP),
        ) {
            // #194 : `borderRadius: 300` sur une barre de 6 dp, c'est une BOULE :
            // les deux extrémités sont des demi-cercles de 3 dp. Un `Box` droit
            // donnait deux angles vifs, visibles à cette échelle.
            Box(
                modifier = Modifier
                    .width(SPINE_WIDTH)
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(spine),
            )
            Column(
                modifier = Modifier.weight(1f),
                // `gap: 2` sur la colonne de contenu de la référence.
                verticalArrangement = Arrangement.spacedBy(STACK_GAP),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = label,
                        // #194 : `h5` GRAS, interligne 24. C'était `titleMedium`
                        // (17 sp, medium) — la taille d'un libellé d'action. La
                        // référence pose `variant="h5" weight="bold"` avec
                        // `lineHeight: 24` sur le bloc du nom.
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            lineHeight = 24.sp,
                        ),
                        color = ink,
                        // 2 lignes hors variante compacte (`numberOfLines={compact
                        // ? 1 : 2}`). Une seule ligne tronquait un nom de matière
                        // long AU MILIEU DU MOT.
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        textDecoration = if (cancelled) TextDecoration.LineThrough else null,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    when {
                        cancelled -> PapPill(CANCELLED_LABEL, error)
                        highlight == CourseHighlight.CURRENT -> PapPill(CURRENT_LABEL, spine)
                        highlight == CourseHighlight.NEXT -> PapPill(NEXT_LABEL, spine)
                    }
                }
                val room = lesson.room?.takeIf { it.isNotEmpty() }
                val teacher = lesson.teacher?.takeIf { it.isNotEmpty() }
                if (room != null || teacher != null) {
                    // #194 : `marginTop: 1` sur la ligne salle/professeur, et 8 dp
                    // de marge de chaque côté du séparateur — pas un `gap` de Row,
                    // parce que la source met la marge SUR le trait.
                    Row(
                        modifier = Modifier.padding(top = META_LINE_GAP),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(META_DIVIDER_MARGIN),
                    ) {
                        if (room != null) {
                            PapMetaChip(
                                icon = Icons.Filled.Place,
                                text = room,
                                tint = ink,
                                // `body1` semibold, `fontSize: 16`.
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    fontSize = 16.sp,
                                    lineHeight = 20.sp,
                                ),
                            )
                        }
                        if (room != null && teacher != null) {
                            Box(
                                modifier = Modifier
                                    .width(META_DIVIDER_WIDTH)
                                    .height(META_DIVIDER_HEIGHT)
                                    .clip(CircleShape)
                                    .background(ink.copy(alpha = META_DIVIDER_ALPHA)),
                            )
                        }
                        if (teacher != null) {
                            PapMetaChip(
                                icon = Icons.Filled.Person,
                                text = teacher,
                                tint = ink,
                                // Même `body1` semibold, `fontSize: 15`, et une
                                // seule ligne avec troncature à la fin
                                // (`numberOfLines={1} ellipsizeMode="tail"`).
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    fontSize = 15.sp,
                                    lineHeight = 20.sp,
                                ),
                            )
                        }
                    }
                }
                val duration = lessonDurationLabel(lesson)
                val moved = movedHintLabel(lesson, zone)
                if (duration.isNotEmpty() || moved != null) {
                    Text(
                        text = listOfNotNull(duration, moved).joinToString(" · "),
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
 * Pause méridienne : une PASTILLE BLANCHE à part, jamais teintée — une pause
 * n'appartient à aucune matière, donc lui prêter celle d'un cours mentirait.
 *
 * Elle n'est pas dans le payload (le contrat `/v1/timetable` ne publie que des
 * cours) : elle est DÉDUITE du creux qui contient 12 h 30, cf.
 * [lunchBreakOf]. Blanc = rôle `surface` du thème, filet 1 dp pour rester
 * visible sur le fond blanc ; durée alignée à droite.
 */
@Composable
fun PapLunchCard(label: String, duration: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        // #194 : `radius={300}` côté source, soit un pilier — la bande fait
        // 8 + 8 + 24 = 40 dp de haut, et 300dp de rayon y est clampé à 20, donc
        // DÉJÀ un pilier avec les 20 de `shapes.large`. On l'écrit en `percent`
        // quand même, pour que l'intention soit lisible dans le code et qu'un
        // jour où la bande change de hauteur, la forme suive au lieu de
        // dériver vers un rectangle à coins francs.
        shape = RoundedCornerShape(percent = 50),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outline),
    ) {
        Row(
            // #194 : `padding={[14, 8]}` — 14 en horizontal, 8 en vertical. La
            // bande est donc plus basse que les cartes de cours, comme chez la
            // référence : elle encadre, elle ne présente pas.
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = CARD_PADDING_H, vertical = LUNCH_PADDING_V),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(META_DIVIDER_MARGIN),
        ) {
            // `size={24} opacity={0.6}` : l'icône et le texte sont posés au même
            // poids, tous deux en retrait — donc l'icône n'est pas un glyphe
            // principal posé devant un libellé secondaire.
            PapCutleryIcon(tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = LUNCH_ALPHA))
            Text(
                text = label,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = LUNCH_ALPHA),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (duration.isNotEmpty()) {
                Text(
                    text = duration,
                    style = MaterialTheme.typography.labelMedium,
                    // #194 : `colors.text + "80"` — donc 0,5, et NON les 0,6 de
                    // l'icône et du libellé. La durée est la seule chose que la
                    // référence pose en retrait DIFFERENT, et elle est à droite :
                    // c'est de la précision, pas de la hiérarchie.
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = LUNCH_DURATION_ALPHA),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Gouttière de temps : début en gras, fin en encre secondaire, tous deux
 * centrés dans [TimetableTimeGutterWidth].
 *
 * L'heure affichée est TOUJOURS celle de la zone d'affichage (`lessonTimeLabel`
 * formate dans la zone passée), jamais l'heure brute du serveur : à 23 h de
 * décalage, ce sont les deux heures qui divergent, pas le jour.
 */
@Composable
fun PapLessonTimeGutter(lesson: TimetableLessonUi, zone: ZoneId, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .width(TimetableTimeGutterWidth)
            // #194 : `gap: 3` entre les deux heures, et `paddingRight: 2`. Avant,
            // les deux lignes se touchaient — donc « 08:00 » au-dessus de
            // « 09:55 » se lisait comme un nombre à huit chiffres.
            .padding(end = TIME_GUTTER_PADDING_END),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TIME_GUTTER_GAP),
    ) {
        Text(
            text = lessonTimeLabel(lesson.startMillis, zone),
            // #194 : `h5` (18 sp) avec un interligne FORCÉ à 20 — son `h5`
            // déclare 32, qu'elle écrase ici (`lineHeight: 20`). On garde
            // l'écrasement : 32 laisserait un trou de 12 dp entre les deux lignes
            // de la gouttière. C'était `titleSmall` (14 sp).
            style = MaterialTheme.typography.titleLarge.copy(lineHeight = TIME_START_LEADING),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = lessonTimeLabel(lesson.endMillis, zone),
            // `body2` semibold : 15 sp, interligne 19. Notre `bodySmall` (13 sp)
            // rendait l'heure de FIN plus petite que la largeur d'un « 0 ».
            style = MaterialTheme.typography.bodyLarge.copy(
                lineHeight = TIME_END_LEADING,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Icône + texte d'une ligne de méta, dans l'encre de la matière.
 *
 * #194 : [style] est un paramètre parce que la SALLE et le PROFESSEUR n'ont pas
 * la même taille dans la référence — 16 et 15 dp, deux `fontSize` posés sur le
 * même `body1`. Une seule valeur pour les deux aurait effacé la différence.
 */
@Composable
private fun PapMetaChip(icon: ImageVector, text: String, tint: Color, style: TextStyle) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(META_ICON_GAP),
    ) {
        // Décorative : c'est le TEXTE (salle, professeur) qui porte le sens.
        Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = Modifier.size(META_ICON))
        Text(
            text = text,
            style = style,
            // L'encre vient d'ici et PAS du style : un `TextStyle` sans couleur
            // vaut `Unspecified`, et l'encre de contenu d'une `Card` dont le fond
            // est un pastel hors palette Material est elle-même `Unspecified`.
            // Sans cette ligne, la salle et le professeur retombaient sur
            // l'encre de l'ÉCRAN — donc plus aucune matière n'était peinte par le
            // pas mesuré à 4,5:1, qui est la raison d'être de ce composant.
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Fourchette et couteau DESSINÉS (cf. l'en-tête du fichier : `Restaurant` est
 * hors `material-icons-core`, et la liste des modules Gradle est figée).
 * Monochrome et teintable : un glyphe emoji multicolore ne suit pas le thème.
 */
@Composable
private fun PapCutleryIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(CUTLERY_SIZE)) {
        val u = size.minDimension / CUTLERY_UNITS
        val w = u * 1.5f
        // Fourchette : trois dents, une traverse, un manche.
        drawLine(tint, Offset(3f * u, 2.5f * u), Offset(3f * u, 7.5f * u), w)
        drawLine(tint, Offset(4.7f * u, 2.5f * u), Offset(4.7f * u, 7.5f * u), w)
        drawLine(tint, Offset(6.4f * u, 2.5f * u), Offset(6.4f * u, 7.5f * u), w)
        drawLine(tint, Offset(3f * u, 7.5f * u), Offset(6.4f * u, 7.5f * u), w)
        drawLine(tint, Offset(4.7f * u, 7.5f * u), Offset(4.7f * u, 17.5f * u), w)
        // Couteau : lame (triangle) puis manche.
        drawPath(
            path = Path().apply {
                moveTo(10.2f * u, 2.5f * u)
                lineTo(12.4f * u, 2.5f * u)
                lineTo(11.3f * u, 10f * u)
                close()
            },
            color = tint,
        )
        drawLine(tint, Offset(11.3f * u, 9.5f * u), Offset(11.3f * u, 17.5f * u), w * 0.9f)
    }
}
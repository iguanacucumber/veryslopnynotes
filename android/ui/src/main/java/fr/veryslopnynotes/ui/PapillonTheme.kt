package fr.veryslopnynotes.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.absoluteValue
import kotlin.math.pow

// Thème Papillon #134 : jetons de design relevés sur papillon.bzh. AVANT ce
// fichier, le thème tenait en une ligne — `lightColorScheme()` /
// `darkColorScheme()` SANS ARGUMENT — donc l'app rendait en violet Material par
// défaut, et `MaterialTheme` ne recevait ni `typography` ni `shapes` : tout le
// texte valait 14 sp, donc aucune hiérarchie visuelle.
//
// Police : SN Pro est le clone SF Pro d'Apple, absent d'Android. Roboto —
// `FontFamily.SansSerif`, la police système d'Android — est l'équivalent le plus
// proche côté Android, donc AUCUN fichier de police n'est embarqué (zéro
// dépendance ajoutée, poids d'APK inchangé). Upgrade: embarquer SN Pro si sa
// licence le permet un jour.
//
// ponytail: un jeton = une constante, pas une arborescence de rôles. Pas de
// Dynamic Color — le vert Papillon EST l'identité, et `dynamicLightColorScheme`
// le remplacerait par la couleur du fond d'écran. Pas de thème par matière non
// plus : la couleur matière passe par `subjectSurface` / `subjectContent`.

// --- Couleurs de marque -----------------------------------------------------

/** Vert Papillon. 3.74:1 sur blanc : couleur d'INTERFACE, jamais de corps de
 *  texte (WCAG 1.4.3 ne vise que le texte). */
val PapillonGreen = Color(0xFF29947AL)

/** Vert clair — dégradé, chip secondaire. 2.87:1 sous du blanc : il ne porte donc
 *  pas de texte blanc, c'est pourquoi le rôle `secondary` du scheme clair prend
 *  [PapillonGreenDeep] et que celui du scheme sombre prend ce vert avec une
 *  encre sombre (cf. `papillonColorScheme`). */
val PapillonGreenLight = Color(0xFF48A98BL)

/** Vert profond — texte d'accent sur fond pastel : `onPrimaryContainer`. */
val PapillonGreenDeep = Color(0xFF237E68L)

/** Accent lime. */
val PapillonLime = Color(0xFFBFE677L)

/** Encre de l'accent lime. 3.57:1 sur le lime : valeur de marque relevée, on ne
 *  la remplace pas par un noir qui passerait 4.5:1 et trahirait la marque. */
val PapillonLimeInk = Color(0xFF5A7821L)

/** Danger / erreur. 5.07:1 sous du blanc. */
val PapillonDanger = Color(0xFFDC1400L)

/** Encre de texte. 14.84:1 sur blanc : la paire de texte la plus sûre du thème. */
val PapillonInk = Color(0xFF1F292EL)

/** Bordure de champ / séparateur. */
val PapillonBorder = Color(0xFFDCDCDCL)

/** Surface claire. */
val PapillonSurface = Color(0xFFFFFFFFL)

/** Surface variante (cartes, champs). */
val PapillonSurfaceVariant = Color(0xFFF3F6F7L)

/**
 * Vert très pâle : fond des conteneurs `primaryContainer` /
 * `secondaryContainer`. Dérivé du vert de marque par [tint] (94 % vers le
 * blanc) plutôt que recopié : l'encre de marque y tient 4.61:1, donc c'est le
 * pas le plus clair qui garde AA.
 */
val PapillonGreenPale = tint(PapillonGreen, .94f)

/** Surface « conteneur », une nuance sous `surfaceVariant`. */
val PapillonSurfaceContainer = Color(0xFFF1F1F1L)

/** Surface sombre. */
val PapillonDarkSurface = Color(0xFF121212L)

/** Fond sombre — le thème sombre est NOIR, pas gris. */
val PapillonDarkBackground = Color(0xFF000000L)

/**
 * Opacité de l'encre de texte secondaire.
 *
 * Papillon compose son gris secondaire à 53 % d'opacité, ce qui mesure 3.32:1
 * sur blanc — sous le 4.5:1 du WCAG AA pour un corps de texte. 65 % garde
 * exactement le même parti pris (« moins prominent que l'encre ») tout en
 * repassant AA : 4.76:1 sur blanc, 7.6:1 sur la surface sombre. Sur une puce de
 * matière, c'est 4.5:1 qui fait la loi : cf. [subjectContent].
 */
const val PapillonSecondaryAlpha = 0.65f

// --- Palette matières -------------------------------------------------------

/**
 * Les 20 couleurs de matière de papillon.bzh. Liste de chaînes, pas de
 * `Color` : ces couleurs servent de graine à [subjectSurface] /
 * [subjectContent] / [bestContentOn], et une matière choisie par l'utilisateur
 * est une chaîne venue du serveur.
 */
val SubjectPalette: List<String> = listOf(
    "#C50017", "#DA2400", "#DD6B00", "#E8901C", "#E8B048",
    "#6BAE00", "#37BB12", "#12BB67", "#26B290", "#26ABB2",
    "#2DB9D8", "#009EC5", "#007FDA", "#3A56D0", "#7600CA",
    "#962DD8", "#B300CA", "#C50066", "#DD004A", "#DD0030",
)

// --- Helpers purs (sans effet de bord, donc testables) ----------------------

private val PAPILLON_HEX_RE = Regex("^#[0-9a-fA-F]{6}$")

private fun papillonColor(hex: String): Color? =
    if (PAPILLON_HEX_RE.matches(hex)) Color(0xFF000000L or hex.substring(1).toLong(16)) else null

/**
 * Reproduction de l'`adjustColor` de Papillon : [p] > 0 tire vers le blanc,
 * [p] < 0 tire vers le noir, `p = 0` rend la couleur inchangée. [p] est ramené
 * dans `0..1`, donc aucune valeur ne peut sortir du noir ni du blanc.
 */
fun tint(color: Color, p: Float): Color {
    val amount = p.absoluteValue.coerceIn(0f, 1f)
    val towardWhite = p >= 0f
    fun channel(v: Float): Float = if (towardWhite) v + (1f - v) * amount else v - v * amount
    return Color(
        red = channel(color.red),
        green = channel(color.green),
        blue = channel(color.blue),
        alpha = color.alpha,
    )
}

/** Même interpolation, depuis une matière `#RRGGBB` (une chaîne venue du
 *  serveur). Renvoie `null` si le hex est absent ou mal formé — jamais de couleur
 *  inventée en guise de repli. */
fun tint(hex: String, p: Float): Color? = papillonColor(hex)?.let { tint(it, p) }

/** Fond de carte matière : la couleur de matière très éclaircie (75 % vers le
 *  blanc), c'est le pastel que Papillon pose derrière le nom du cours. */
fun subjectSurface(hex: String): Color? = tint(hex, .75f)

/**
 * Encre et bordure d'une carte matière.
 *
 * [tint] à −15 % — le pas de Papillon — ne mesure que 2.28:1 au pire de la
 * palette (`#E8B048`) : AA est hors d'atteinte. Or le nom de la matière est du
 * corps de texte, donc c'est 4.5:1 qui fait la loi ; −45 % est le pas le plus
 * clair qui repasse au-dessus pour les 20 couleurs (4.87:1 au pire, mesuré par
 * [contrastRatio] — cf. tests/unit/android-papillon-theme.test.ts).
 */
fun subjectContent(hex: String): Color? = tint(hex, -.45f)

/**
 * Luminance relative WCAG 2.x d'une couleur (canaux non linéarisés).
 * Seuil 0.03928 : c'est la valeur de la spécification 2.x (la version 2.1
 * corrigée porte 0.04045 ; l'écart sur nos couleurs est nul au 1/1000).
 */
fun relativeLuminance(color: Color): Float {
    fun linear(v: Float): Float =
        if (v <= 0.03928f) v / 12.92f else ((v + 0.055f) / 1.055f).pow(2.4f)
    return 0.2126f * linear(color.red) + 0.7152f * linear(color.green) + 0.0722f * linear(color.blue)
}

/** Rapport de contraste WCAG 2.x entre deux couleurs : 1 = identique, 21 = noir sur blanc. */
fun contrastRatio(a: Color, b: Color): Float {
    val la = relativeLuminance(a)
    val lb = relativeLuminance(b)
    return (maxOf(la, lb) + 0.05f) / (minOf(la, lb) + 0.05f)
}

/**
 * Encre lisible sur [background] : **par contraste mesuré**, jamais du blanc en
 * dur. `Competences.kt` force du texte blanc sur une puce dont la couleur vient
 * d'un hachage du libellé — une puce jaune tombait alors à 1.1:1. Ici on
 * compare l'encre de marque au blanc et on garde le meilleur des deux.
 */
fun bestContentOn(background: Color): Color =
    if (contrastRatio(background, PapillonInk) >= contrastRatio(background, Color.White)) {
        PapillonInk
    } else {
        Color.White
    }

// --- Formes ----------------------------------------------------------------

/** 8 / 12 / 18 / 20 dp, puis 25 dp : le rayon des cartes de Papillon. */
val PapillonShapes = papillonShapes(
    extraSmall = 8.dp,
    small = 12.dp,
    medium = 18.dp,
    large = 20.dp,
    extraLarge = 25.dp,
)

private fun papillonShapes(
    extraSmall: Dp,
    small: Dp,
    medium: Dp,
    large: Dp,
    extraLarge: Dp,
): Shapes = Shapes(
    extraSmall = RoundedCornerShape(extraSmall),
    small = RoundedCornerShape(small),
    medium = RoundedCornerShape(medium),
    large = RoundedCornerShape(large),
    extraLarge = RoundedCornerShape(extraLarge),
)

// --- Typographie ------------------------------------------------------------

/**
 * Échelle Papillon portée sur Compose : titres en gras, interligne 1.2x pour
 * display/title/headline et 1.4x pour le corps.
 *
 * `bodyMedium` reste à 14 sp : c'est le style par défaut de `MaterialTheme`, donc
 * le texte non stylé ne bouge pas. Les écrans gagnent leur hiérarchie en
 * passant explicitement à `titleMedium` / `bodyLarge`, écran par écran.
 */
val PapillonTypography = Typography(
    displayLarge = papillonText(34, 41, FontWeight.Bold),
    displayMedium = papillonText(28, 34, FontWeight.Bold),
    displaySmall = papillonText(24, 29, FontWeight.Bold),
    headlineLarge = papillonText(22, 27, FontWeight.Bold),
    headlineMedium = papillonText(20, 24, FontWeight.Bold),
    headlineSmall = papillonText(18, 22, FontWeight.Bold),
    // 18 sp gras : le titre de la barre d'application, donc le texte le plus
    // visible de l'échelle tant qu'aucun écran n'a stylé le sien.
    titleLarge = papillonText(18, 22, FontWeight.Bold),
    titleMedium = papillonText(16, 22, FontWeight.Bold),
    titleSmall = papillonText(14, 19, FontWeight.Bold),
    bodyLarge = papillonText(15, 21),
    bodyMedium = papillonText(14, 20),
    bodySmall = papillonText(13, 18),
    labelLarge = papillonText(14, 18, FontWeight.Medium),
    labelMedium = papillonText(13, 17, FontWeight.Medium),
    labelSmall = papillonText(13, 17),
)

private fun papillonText(size: Int, lineHeight: Int, weight: FontWeight = FontWeight.Normal): TextStyle =
    TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = size.sp,
        lineHeight = lineHeight.sp,
        fontWeight = weight,
    )

// --- Schemes ---------------------------------------------------------------

/**
 * Scheme Material3 du thème Papillon. [dark] bascule sur le thème sombre réel
 * (surface `#121212`, fond `#000000`), pas sur les valeurs Material par défaut,
 * qui sont violettes.
 *
 * Les surfaces sombres et la bordure sombre ne sont pas des valeurs recopiées :
 * ce sont les tons clairs du thème passé par le même [tint] (surface 10 % / 5 %
 * au-dessus du noir, bordure tirée vers le gris depuis l'encre de marque), donc
 * une seule palette les gouverne. Upgrade: si un rôle non posé apparaît à
 * l'écran, le poser ici — pas de registre de thèmes.
 */
fun papillonColorScheme(dark: Boolean): ColorScheme = if (dark) PapillonDarkColors else PapillonLightColors

private val PapillonLightColors: ColorScheme = lightColorScheme(
    primary = PapillonGreen,
    // 3.74:1 : le blanc sur le vert de marque tient AA pour le texte de grande
    // taille et pour l'interface ; le corps de texte, lui, prend l'encre.
    onPrimary = Color.White,
    primaryContainer = PapillonGreenPale,
    onPrimaryContainer = PapillonGreenDeep,
    secondary = PapillonGreenDeep,
    onSecondary = Color.White,
    // Sans ce rôle, la pastille d'onglet_selected reste au lavande Material
    // (`secondaryContainer`, #E8DEF8) : c'est le dernier violet visible.
    secondaryContainer = PapillonGreenPale,
    onSecondaryContainer = PapillonGreenDeep,
    tertiary = PapillonLime,
    onTertiary = PapillonLimeInk,
    background = PapillonSurface,
    onBackground = PapillonInk,
    surface = PapillonSurface,
    onSurface = PapillonInk,
    surfaceVariant = PapillonSurfaceVariant,
    onSurfaceVariant = PapillonInk.copy(alpha = PapillonSecondaryAlpha),
    // Un cran sous `surfaceContainer`, dérivé du même ton par le même `tint`.
    surfaceContainerLow = tint(PapillonSurfaceContainer, .35f),
    outline = PapillonBorder,
    outlineVariant = Color(0x22000000L),
    error = PapillonDanger,
    onError = Color.White,
)

private val PapillonDarkColors: ColorScheme = darkColorScheme(
    primary = PapillonGreen,
    onPrimary = Color.White,
    primaryContainer = tint(PapillonGreen, -.35f),
    onPrimaryContainer = tint(PapillonGreen, .70f),
    secondary = PapillonGreenLight,
    // 2.87:1 sous du blanc : ici c'est l'encre sombre qui gagne (6.53:1).
    onSecondary = PapillonDarkSurface,
    // Le pastille d'onglet selectionnee : M3 y met `secondaryContainer`. Le
    // laisser au lavande Material gardait le dernier violet visible a l'ecran,
    // alors que l'encre de marque y tient 13.87:1.
    secondaryContainer = PapillonGreenPale,
    onSecondaryContainer = PapillonInk,
    tertiary = PapillonLime,
    onTertiary = PapillonLimeInk,
    background = PapillonDarkBackground,
    onBackground = Color.White,
    surface = PapillonDarkSurface,
    onSurface = Color.White,
    surfaceVariant = tint(PapillonDarkSurface, .10f),
    onSurfaceVariant = Color.White.copy(alpha = PapillonSecondaryAlpha),
    surfaceContainerLow = tint(PapillonDarkSurface, .05f),
    outline = tint(PapillonInk, .45f),
    outlineVariant = Color(0x22FFFFFFL),
    error = PapillonDanger,
    onError = Color.White,
)

// --- Câblage ----------------------------------------------------------------

/**
 * Thème appliqué UNE fois à la racine : c'est le seul endroit du module où
 * l'interface prend ses jetons. Fournit couleurs + typographie + formes en un
 * seul appel.
 */
@Composable
fun PapillonTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = papillonColorScheme(darkTheme),
        typography = PapillonTypography,
        shapes = PapillonShapes,
        content = content,
    )
}
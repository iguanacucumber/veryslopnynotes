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
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
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
// #188 : les valeurs sont désormais relevées sur la SOURCE de l'application de
// référence (v8.5.5, GPL-3.0, lue hors dépôt et jamais copiée) au lieu d'être
// estimées à l'œil sur le site. Ce qui change : l'échelle typographique et les
// rayons (cf. [PapillonTypography] et [PapillonShapes]), et la police.
//
// Police : Papillon compose en SN Pro, le clone SF Pro d'Apple. SN Pro n'est
// pas redistribuable hors interface Apple — on ne l'embarque donc pas, et on ne
// copie pas un octet de ses fichiers, y compris pour mesurer. À la place, on
// embarque FIGTREE (SIL OFL 1.1), choisie parce que ses largeurs d'avance sont
// les plus proches de celles de SN Pro : 1.16 % d'écart moyen et 2.88 % au pire
// sur des chaînes d'interface, aux graisses 400/600/700, contre 2.12 % / 5.70 %
// pour Roboto (la police système d'Android, précédente). Le pire cas de Roboto
// tombait sur les chaînes de chiffres — l'EDT est un écran de chiffres.
// Licence dans `res/raw/figtree_ofl.txt`, embarquée dans l'APK (une licence
// laissée dans `docs/` n'est pas livrée à l'utilisateur de l'app).
//
// ponytail: un jeton = une constante, pas une arborescence de rôles. Pas de
// Dynamic Color — le vert Papillon EST l'identité, et `dynamicLightColorScheme`
// le remplacerait par la couleur du fond d'écran. Pas de thème par matière non
// plus : la couleur matière passe par `subjectSurface` / `subjectContent`.

// --- Police ------------------------------------------------------------------

/**
 * Figtree, variable 300→900, sous-ensemble Latin + accents français (39,7 Ko,
 * 291 glyphes).
 *
 * Un seul fichier pour cinq graisses : l'axe `wght` est piloté par
 * [FontVariation], donc pas cinq `Font` à embarquer. Papillon utilise les
 * graisses light/regular/medium/semibold/bold de SN Pro — les mêmes cinq.
 *
 * `FontVariation` n'est pris en compte qu'à partir d'API 26, ce qui est
 * exactement notre `minSdk`.
 */
private val FIGTREE_ID = R.font.figtree_subset

// `FontVariation` est marquée `@ExperimentalTextApi` : c'est le seul endroit
// qui l'utilise, donc l'opt-in est posé ICI plutôt qu'au niveau du fichier, et
// il est retiré en même temps que l'axe variable.
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun figtree(weight: Int) =
    Font(
        resId = FIGTREE_ID,
        weight = FontWeight(weight),
        variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
    )

/** Les cinq graisses de SN Pro, dans l'ordre où l'application de référence les
 *  déclare (`WEIGHTS = ["light", "regular", "medium", "semibold", "bold"]`). */
val PapillonFont = FontFamily(
    figtree(300),
    figtree(400),
    figtree(500),
    figtree(600),
    figtree(700),
)

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

/**
 * Côte minimal d'une cible tactile, en dp.
 *
 * WCAG 2.5.8 (AA) demande 24 × 24 dp, Material en impose 48 : on pose 48, le
 * plus exigeant des deux. C'est le SEUL endroit du module où la valeur est
 * écrite — `IconButton`, `Button` et `ListItem` la respectent déjà par leur
 * propre mise en page ; un jeton maison cliquable (puce, pastille, ligne
 * d'en-tête) doit la poser lui-même.
 *
 * ponytail: une constante, pas un `Dimension` Material ni un helper qui gonfle la
 * boîte — une cible trop petite se répare en AGRANDISSANT la boîte qui porte le
 * `clickable`, pas en socialisant le trait.
 */
val TouchTarget = 48.dp

/**
 * Pas d'éclaircissement de l'encre d'erreur en thème SOMBRE, en `tint`.
 *
 * `error` (#DC1400) tient 5.07:1 sur la surface CLAIRE mais 3.70:1 sur la surface
 * sombre `#121212` : sous le 4.5:1 du WCAG AA, donc un bandeau d'erreur en
 * thème sombre n'était pas lisible. 70 % vers le blanc donne 11.07:1 sur la
 * surface sombre et 8.52:1 sur la surface variante — mesuré par le miroir de
 * `tests/unit/android-papillon-theme.test.ts`.
 */
const val ERROR_INK_TINT = 0.70f

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

/** Fond de carte matière en thème CLAIR : 75 % vers le blanc, c'est le pastel
 *  que Papillon pose derrière le nom du cours. */
const val SUBJECT_SURFACE_TINT = 0.75f

/**
 * Fond de carte matière en thème SOMBRE : 60 % vers le noir.
 *
 * Un pas UNIQUE ne peut pas servir les deux thèmes, les deux directions étant
 * opposées : en sombre, un pastel à 75 % vers le blanc est un aplat clair qui
 * brûle sur un fond noir ET rend toute encre de texte du thème (`onSurface`,
 * blanc) invisible sur la carte. Le même pas que [cancelledSurface] en sombre.
 */
const val SUBJECT_SURFACE_DARK_TINT = -0.60f

/**
 * Encre et bordure d'une carte matière en thème CLAIR.
 *
 * [tint] à −15 % — le pas de Papillon — ne mesure que 2.28:1 au pire de la
 * palette (`#E8B048`) : AA est hors d'atteinte. Or le nom de la matière est du
 * corps de texte, donc c'est 4.5:1 qui fait la loi ; −45 % est le pas le plus
 * clair qui repasse au-dessus pour les 20 couleurs (4.87:1 au pire, mesuré par
 * [contrastRatio] — cf. tests/unit/android-papillon-theme.test.ts).
 */
const val SUBJECT_CONTENT_LIGHT_TINT = -0.45f

/**
 * Encre matière en thème SOMBRE : 55 % vers le blanc.
 *
 * #179 : −45 % ASSOMBRIT toujours la matière, donc un vert assombri sur une
 * carte presque noire n'a plus aucun contraste (le pas était figé pour le fond
 * clair). 55 % vers le blanc remonte à 7.31:1 au pire des 20 sur la surface
 * sombre, 6.29:1 sur le fond de carte ci-dessus — mesuré, pas deviné.
 */
const val SUBJECT_CONTENT_DARK_TINT = 0.55f

/** Fond de carte matière, dans le thème demandé. */
fun subjectSurface(hex: String, dark: Boolean): Color? =
    tint(hex, if (dark) SUBJECT_SURFACE_DARK_TINT else SUBJECT_SURFACE_TINT)

/** Encre matière, dans le thème demandé : le pas suit le fond, il ne le précède
 *  pas (cf. [SUBJECT_CONTENT_DARK_TINT]). */
fun subjectContent(hex: String, dark: Boolean): Color? =
    tint(hex, if (dark) SUBJECT_CONTENT_DARK_TINT else SUBJECT_CONTENT_LIGHT_TINT)

/**
 * Opacité du fond d'une carte matière dans le CARROUSEL de l'onglet Notes :
 * `21/255`, soit le `'15'` que la référence concatène à la couleur de la matière
 * (`ui/new/CompactGrade.tsx`, branche Android).
 *
 * #192 : c'est un ALPHA, pas un pas vers le blanc. Notre [SUBJECT_SURFACE_TINT]
 * (75 % vers le blanc) donne un aplat opaque — donc la teinte est diluée dans du
 * blanc et la carte « brille » — tandis qu'à 8 % la matière se transparaît sur le
 * fond de l'écran et la couleur se lit comme une TEINTE, pas comme une couleur.
 * Les deux ne se ressemblent pas, et la référence est nette : c'est un aplat
 * translucide posé sur le fond, pas un pastel calculé.
 *
 * 0x15 = 21, donc 21/255 = 0,0824 — le même nombre des deux côtés de l'octet,
 * contrairement à la convention « FF = 100 % » du suffixe hexadécimal.
 */
const val SUBJECT_CARD_ALPHA = 21f / 255f

/**
 * Fond translucide d'une carte matière du carrousel.
 *
 * Pas de variante sombre, et c'est VOLONTAIRE : la référence n'en pose pas (le
 * `'15'` est écrit en dur, hors de tout `theme.dark`). La couleur est rendue avec
 * son alpha, donc elle se compose sur le fond de l'écran — le même fond dans les
 * deux thèmes.
 */
fun subjectCardTint(hex: String): Color? =
    papillonColor(hex)?.copy(alpha = SUBJECT_CARD_ALPHA)

/** Raccourci `@Composable` des deux : le mode se LIT dans le thème
 *  ([isDarkSurface]) au lieu d'être câblé deux fois par l'appelant, donc une
 *  encre de matière ne peut pas être choisie pour le mauvais thème. */
@Composable
fun subjectSurface(hex: String): Color? = subjectSurface(hex, isDarkSurface())

@Composable
fun subjectContent(hex: String): Color? = subjectContent(hex, isDarkSurface())

/**
 * Encre de matière lisible sur le fond RÉEL d'un composant : une puce sélectionnée
 * n'a pas le fond d'une puce au repos, et le `secondaryContainer` du thème sombre
 * reste un aplat clair. On garde donc le pas du thème qui passe le mieux,
 * mesuré — la même partis pris que [bestContentOn], appliquée aux deux pas du
 * thème au lieu du seul blanc.
 */
fun bestSubjectContentOn(hex: String, background: Color): Color? =
    listOfNotNull(subjectContent(hex, false), subjectContent(hex, true))
        .maxByOrNull { contrastRatio(it, background) }

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
 * dur. L'écran Compétences (supprimé en #184) forçait du texte blanc sur une
 * puce dont la couleur venait d'un hachage du libellé — une puce jaune tombait
 * alors à 1.1:1. Ici on compare l'encre de marque au blanc et on garde le
 * meilleur des deux.
 */
fun bestContentOn(background: Color): Color =
    if (contrastRatio(background, PapillonInk) >= contrastRatio(background, Color.White)) {
        PapillonInk
    } else {
        Color.White
    }

/**
 * Encre d'erreur DESTINÉE À DU TEXTE, dans les deux thèmes.
 *
 * Le rôle `error` du scheme est un aplat : blanc dessus, 5.07:1 en clair. En
 * thème sombre il ne vaut que 3.70:1 sur la surface `#121212` — sous AA — donc
 * un texte d'erreur y serait illisible. [errorInk] l'éclaircit de [ERROR_INK_TINT]
 * quand [dark] est vrai, et ne le touche pas sinon (la marque reste le rouge
 * relevé sur papillon.bzh).
 *
 * Fonction PURE : le contraste des deux thèmes se teste sans téléphone.
 */
fun errorInk(error: Color, dark: Boolean): Color = if (dark) tint(error, ERROR_INK_TINT) else error

/**
 * Raccourci `@Composable` d'[errorInk] : le mode se LIT dans le thème
 * (`relativeLuminance(surface)`, cf. [isDarkSurface]) au lieu d'être câblé deux
 * fois par l'appelant, donc une encre d'erreur ne peut pas être choisie pour le
 * mauvais thème.
 */
@Composable
fun errorTextColor(): Color = errorInk(MaterialTheme.colorScheme.error, isDarkSurface())

// --- Formes ----------------------------------------------------------------

/**
 * Les CINQ rayons de l'application de référence (v8.5.5), relevés sur ses
 * composants : 8 dp sur le bloc de cours et la bordure fine, 12 dp sur la
 * feuille d'erreur, 16 dp sur les champs de saisie et les menus d'action,
 * 20 dp sur les puces et pastilles de matière, 24 dp sur les cartes — la carte
 * de moyenne et la vignette de note, donc la surface la plus vue de l'app.
 *
 * AVANT #188 : 8 / 12 / 18 / 20 / 25. Le 18 et le 25 n'existent pas chez
 * Papillon, et sa carte de moyenne est à 24, pas 25 : les deux cartes les plus
 * vues de l'application rendaient donc un rayon qu'aucun écran de référence ne
 * montre.
 */
val PapillonShapes = papillonShapes(
    extraSmall = 8.dp,
    small = 12.dp,
    medium = 16.dp,
    large = 20.dp,
    extraLarge = 24.dp,
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
 * Interlettrage du `caption` de la référence, en sp : la seule valeur qu'elle
 * porte en `letterSpacing`. Déclarée AVANT [PapillonTypography] parce que
 * Kotlin n'initialise un `val` de fichier que dans l'ordre de lecture — la
 * reprendre plus bas donnerait « must be initialized ».
 */
private val CAPTION_TRACKING = 0.1.sp

/**
 * Échelle typographique relevée sur `ui/new/Typography.tsx` de
 * l'application de référence (v8.5.5) : onze variantes nommées
 * (`h1`…`h5`, `title`, `action`, `body1`, `body2`, `caption`, `header`), dont
 * on mappe chacune sur un rôle Material3.
 *
 * L'interligne de la référence est un pourcentage de la taille ; il est
 * calculé ici et figé (`34 → 41`, soit 120 %). Les valeurs de la référence :
 * `34/28/24` à 120 %, `21/19/18` à 130 %, `17/15/14/13` à 140 %, le `caption`
 * portant en plus 0,1 sp d'interlettrage — d'où [CAPTION_TRACKING].
 *
 * Deux écarts assumés : `bodyMedium` reste à 14 sp (style par défaut de
 * `MaterialTheme`, donc le texte non stylé ne bouge pas de taille) et `title`
 * vaut 18 sp sur Android, pas 17 — la référence elle-même fait cette
 * différence de plateforme, on garde sa valeur Android.
 */
val PapillonTypography = Typography(
    // h1 / h2 / h3, gras, interligne 120 %.
    displayLarge = papillonText(34, 41, FontWeight.Bold),
    displayMedium = papillonText(28, 34, FontWeight.Bold),
    displaySmall = papillonText(24, 29, FontWeight.Bold),
    // h4 / h5, gras, interligne 130 %.
    headlineLarge = papillonText(21, 27, FontWeight.Bold),
    headlineMedium = papillonText(19, 25, FontWeight.Bold),
    // `title` de la référence : 18 sp sur Android, gras, 130 %. C'est le titre
    // de la barre d'application, donc le texte le plus visible de l'échelle.
    headlineSmall = papillonText(18, 23, FontWeight.Bold),
    titleLarge = papillonText(18, 23, FontWeight.Bold),
    // `action` : 17 sp medium, 140 %.
    titleMedium = papillonText(17, 24, FontWeight.Medium),
    // `body2` : 14 sp medium, 140 % — le corps le plus lu.
    titleSmall = papillonText(14, 20, FontWeight.Medium),
    // `body1` : 15 sp, SEMIBOLD sur Android (medium sur iOS), 140 %. On garde
    // la valeur Android, donc `bodyLarge` est le seul gras du corps.
    bodyLarge = papillonText(15, 21, FontWeight.SemiBold),
    bodyMedium = papillonText(14, 20, FontWeight.Medium),
    // `caption` : 13 sp medium, 140 %, + 0,1 sp d'interlettrage.
    bodySmall = papillonText(13, 18, FontWeight.Medium, CAPTION_TRACKING),
    labelLarge = papillonText(17, 24, FontWeight.Medium),
    labelMedium = papillonText(13, 18, FontWeight.Medium, CAPTION_TRACKING),
    labelSmall = papillonText(13, 18, FontWeight.Medium, CAPTION_TRACKING),
)

private fun papillonText(
    size: Int,
    lineHeight: Int,
    weight: FontWeight = FontWeight.Normal,
    tracking: TextUnit = TextUnit.Unspecified,
): TextStyle = TextStyle(
    fontFamily = PapillonFont,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    fontWeight = weight,
    letterSpacing = tracking,
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
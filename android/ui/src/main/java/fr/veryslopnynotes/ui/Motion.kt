package fr.veryslopnynotes.ui

import android.animation.ValueAnimator
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// MOUVEMENT, RETOUR PHYSIQUE ET NOTICES #145.
//
// AVANT ce fichier, le module n'avait ni animation d'apparition, ni retour
// haptique, ni snackbar : `grep animate|AnimatedVisibility|Crossfade` sur `ui`
// ne trouvait que le squelette de chargement et le tirail de #143. Les trois
// moments les plus utiles de l'application étaient donc SILENTIÈUX — un devoir
// basculé, une compétence choisie, un QR lu — et le seul retour qui existait
// (`notice` / `error`) était un `Text` sans couleur, sans sévérité, sans
// fermeture : un ÉCHEC s'affichait exactement comme une RÉUSSITE.
//
// CE QUE PORTE CE FICHIEL, et rien d'autre :
//   - les VALEURS MESURÉES de l'app de référence (300 ms, `cubic-bezier(0.3,
//     0.3, 0, 1)`, échelle 0.9 -> 1, ressort d'amortissement 0.8) en constantes
//     uniques, plus les trois briques qui les appliquent ([PapAppear],
//     [PapEnter], [Modifier.papPressable]) ;
//   - le retour haptique, deux mots seulement ([PapHaptics]) ;
//   - la notice transitoire : une seule porte ([LocalPapNotice]), une seule
//     peinture (le `SnackbarHost` de la coquille), et la SÉVÉRITÉ qui décide de
//     la couleur et de la durée.
//
// ZÉRO dépendance ajoutée : uniquement les API d'animation Compose, déjà dans le
// graphe (`animation-core` arrive par `compose.ui`, qui est déclaré). Aucune
// couleur en dur non plus : tout vient de `PapillonTheme.kt` — y compris le
// rouge d'erreur, qui réutilise le couple MESURÉ d'un cours annulé
// ([cancelledSurface] / [cancelledInk]) parce que le thème ne pose aucun rôle
// « surface d'erreur ».
//
// ponytail: pas de `MotionScheme`, pas de catalogue de transitions : quatre
//   briques et une palette. Une cinquième brique se demanderait quel écran
//   l'a réellement appelée — on la créera le jour où deux écrans la/subissent.

// --- Valeurs mesurées -------------------------------------------------------

/** Durée d'une apparition, disparition ou placement, en millisecondes. */
const val MOTION_ENTER_MS = 300

/**
 * Courbe d'apparition mesurée : `cubic-bezier(0.3, 0.3, 0, 1)` — elle part vite
 * puis se pose sans dépassement. Exposée en VALEUR pour que les quatre briques
 * ne puissent pas diverger ; les points de contrôle sont relus par le miroir TS
 * (`tests/unit/android-motion.test.ts`), qui ne peut pas tenir un `Easing`.
 */
val MOTION_ENTER_EASING: Easing = CubicBezierEasing(0.3f, 0.3f, 0f, 1f)

/** Échelle de DÉPART d'un élément qui apparaît : 0.9 -> 1. */
const val MOTION_ENTER_SCALE = 0.9f

/** Amortissement du ressort de presse (mesuré), et sa raideur (« fast » Material). */
const val MOTION_PRESS_DAMPING = 0.8f
const val MOTION_PRESS_STIFFNESS = 400f

/**
 * Échelle PENDANT la presse : 4 %. Au-delà, l'élément semble changer de taille
 * et le tap devient une devinette.
 */
const val MOTION_PRESS_SCALE = 0.96f

/** Durée d'un aller-retour de la pulsation « en cours ». */
const val CURRENT_PULSE_MS = 2_400

/** Amplitude de la pulsation « en cours » : 2 % d'échelle, et l'opacité qui
 *  descend juste assez pour lire un battement sans clignoter. */
const val CURRENT_PULSE_SCALE = 1.02f
const val CURRENT_PULSE_ALPHA = 0.78f

/** Le téléphone a-t-il les animations du système ACTIVÉES ?
 *
 * Compose 1.6.8 n'expose PAS `LocalMotionDurationScale` (arrivé en 1.7.0), donc on
 * interroge la plateforme : `ValueAnimator.areAnimatorsEnabled()` — API 26, soit
 * exactement `minSdk` — vaut `false` quand l'utilisateur a coupé les animations.
 * ponytail: c'est le seul levier que la plateforme donne ici (elle expose aussi
 *   TRANSITION_ANIMATION_SCALE et WINDOW_ANIMATION_SCALE, que Compose ignore).
 *   Upgrade: `LocalMotionDurationScale` dès que le BOM avance.
 */
fun systemAnimationsEnabled(): Boolean =
    runCatching { ValueAnimator.areAnimatorsEnabled() }.getOrDefault(true)

/** Le même réglage, LU UNE FOIS par composition : la valeur est lue dans le
 *  corps des briques, pas à chaque image. */
@Composable
fun rememberMotionOn(): Boolean = remember { systemAnimationsEnabled() }

/** Durée appliquée : 0 ms quand le mouvement est coupé, donc l'état saute. */
fun motionMs(motionOn: Boolean, ms: Int): Int = if (motionOn) ms else 0

/** Amortissement du ressort de presse : 1 sans mouvement, donc aucun rebond. */
fun motionDamping(motionOn: Boolean): Float = if (motionOn) MOTION_PRESS_DAMPING else 1f

/** Spéc d'apparition : 300 ms mesurés, courbe `cubicBezier(0.3, 0.3, 0, 1)`. */
fun motionEnterSpec(motionOn: Boolean): FiniteAnimationSpec<Float> =
    tween(motionMs(motionOn, MOTION_ENTER_MS), easing = MOTION_ENTER_EASING)

/** Même durée et même courbe, pour un placement d'élément de liste (`IntOffset`). */
fun motionPlacementSpec(motionOn: Boolean): FiniteAnimationSpec<IntOffset> =
    tween(motionMs(motionOn, MOTION_ENTER_MS), easing = MOTION_ENTER_EASING)

/** Même durée et même courbe, pour une hauteur qui s'ouvre (`IntSize`). */
fun motionHeightSpec(motionOn: Boolean): FiniteAnimationSpec<IntSize> =
    tween(motionMs(motionOn, MOTION_ENTER_MS), easing = MOTION_ENTER_EASING)

/** Spéc du ressort de presse : amortissement mesuré, ou 1 (aucun rebond) coupé. */
fun motionPressSpec(motionOn: Boolean): FiniteAnimationSpec<Float> =
    spring(dampingRatio = motionDamping(motionOn), stiffness = MOTION_PRESS_STIFFNESS)

/** Pulsation « en cours » : échelle 1 -> [CURRENT_PULSE_SCALE] selon la phase. */
fun pulseScale(phase: Float): Float =
    1f + (CURRENT_PULSE_SCALE - 1f) * phase.coerceIn(0f, 1f)

/** Opacité de la même pulsation : 1 -> [CURRENT_PULSE_ALPHA]. */
fun pulseAlpha(phase: Float): Float =
    1f - (1f - CURRENT_PULSE_ALPHA) * phase.coerceIn(0f, 1f)

// --- Retour physique --------------------------------------------------------

/**
 * Le retour physique de l'application, en DEUX mots.
 *
 * Compose 1.6.8 n'a pas `HapticFeedbackType.Confirm` ni `.Reject` (arrivés en
 * 1.7.0) : impossible de vibrer « refusé » sans une API plus récente, donc on ne
 * l'invente pas et on ne triche pas avec un motif d'animation. [select] sert les
 * changements d'état sans écriture (choix d'une compétence, QR lu), [confirm]
 * sert les écritures parties (devoir basculé, message envoyé, appairage validé).
 * L'ÉCHEC se distingue par la COULEUR de la notice — c'est écrit ici pour que
 * personne n'ajoute un faux « rejeter » plus tard.
 *
 * Les deux types retenus sont disponibles sur TOUTE la plage du module :
 * `LongPress` partout, `TextHandleMove` (un tic d'horloge) partout aussi.
 */
@Stable
class PapHaptics(private val haptics: HapticFeedback) {
    /** Changement d'état sans écriture. */
    fun select() {
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    /** Écriture partie. */
    fun confirm() {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
    }
}

/** Le retour physique de l'écran courant, mémémorisé une seule fois. */
@Composable
fun rememberPapHaptics(): PapHaptics {
    val haptics = LocalHapticFeedback.current
    return remember(haptics) { PapHaptics(haptics) }
}

// --- Briques de mouvement ----------------------------------------------------

/**
 * Bandeau qui APPARAÎT : la hauteur s'ouvre avec l'opacité, 300 ms mesurés.
 *
 * AVANT #145, un bandeau (bandeau « périmé », message de l'assistant d'appairage)
 * s'ajoutait d'un coup et poussait tout ce qui est en dessous de 40 dp, d'un coup
 * aussi : le contenu sous le bandeau sautait, puis revenait à la taille quand il
 * disparaissait.
 */
@Composable
fun PapAppear(visible: Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val motionOn = rememberMotionOn()
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(motionEnterSpec(motionOn)) + expandVertically(motionHeightSpec(motionOn)),
        exit = shrinkVertically(motionHeightSpec(motionOn)) + fadeOut(motionEnterSpec(motionOn)),
    ) {
        content()
    }
}

/**
 * Élément qui APPARAÎT : échelle [MOTION_ENTER_SCALE] -> 1 et opacité 0 -> 1,
 * 300 ms, `cubicBezier(0.3, 0.3, 0, 1)` — les valeurs mesurées de l'app de
 * référence, donc le détail d'une compétence choisie ou le prochain cours
 * apparaissent au lieu d'être téléportés en place.
 */
@Composable
fun PapEnter(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val motionOn = rememberMotionOn()
    AnimatedVisibility(
        visible = true,
        modifier = modifier,
        enter = fadeIn(motionEnterSpec(motionOn)) +
            scaleIn(initialScale = MOTION_ENTER_SCALE, animationSpec = motionEnterSpec(motionOn)),
    ) {
        content()
    }
}

/**
 * Ressort de presse : l'élément s'enfonce de [MOTION_PRESS_SCALE] et revient en
 * amorti ([MOTION_PRESS_DAMPING]). C'est le seul endroit du module qui décide de
 * la réaction au toucher d'un élément cliquable.
 *
 * `graphicsLayer` passe AVANT le `clickable` : l'échelle est un `drawScope`, donc
 * la zone de toucher reste celle de la mise en page — un élément pressé ne rétrécit
 * pas sa cible.
 */
@Composable
fun Modifier.papPressable(
    enabled: Boolean = true,
    role: Role? = null,
    onClickLabel: String? = null,
    onClick: () -> Unit,
): Modifier {
    val motionOn = rememberMotionOn()
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) MOTION_PRESS_SCALE else 1f,
        animationSpec = motionPressSpec(motionOn),
        label = "papPressScale",
    )
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }.clickable(
        // Surcharge à six arguments : c'est la seule qui prenne la source
        // d'interaction, donc `LocalIndication` remplace l'ondulation par défaut.
        interactionSource = press,
        indication = LocalIndication.current,
        enabled = enabled,
        onClickLabel = onClickLabel,
        role = role,
        onClick = onClick,
    )
}

/**
 * Pulsation « en cours » : échelle et opacité en va-et-vient, sur le cours en
 * cours de l'EDT. Une bordure qui changeait déjà d'épaisseur (2 dp) signalait
 * QUEL cours, jamais CE MOMENT-LÀ ; la pulsation le dit dans le temps.
 *
 * La boucle n'est créée que pour le cours actif : une transition infinie par
 * cours de la page serait autant de recompositions par image pour rien. Et elle
 * est coupée avec le reste quand le téléphone a désactivé les animations.
 */
@Composable
fun Modifier.papCurrentPulse(active: Boolean): Modifier {
    val motionOn = rememberMotionOn()
    var layerScale = 1f
    var layerAlpha = 1f
    if (active && motionOn) {
        val phase by rememberInfiniteTransition(label = "papCurrent").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(CURRENT_PULSE_MS), RepeatMode.Reverse),
            label = "papCurrentPhase",
        )
        layerScale = pulseScale(phase)
        layerAlpha = pulseAlpha(phase)
    }
    return if (active) {
        graphicsLayer {
            scaleX = layerScale
            scaleY = layerScale
            alpha = layerAlpha
        }
    } else {
        this
    }
}

// --- Notices -----------------------------------------------------------------

/** Sévérité d'une notice : c'est elle qui décide de la couleur ET de la durée. */
enum class NoticeKind { INFO, SUCCESS, ERROR }

/**
 * Une notice transitoire. [text] est affiché TEL QUEL : c'est le message du
 * serveur quand il y en a un (donnée, jamais une instruction).
 *
 * [actionLabel] + [onAction] n'existent que si l'action est RÉELLEMENT
 * réversible par le serveur : un « Annuler » qui ne ferait que reculer l'écran
 * serait une promesse que l'application ne peut pas tenir, donc on ne l'offre
 * pas.
 */
data class PapNotice(
    val text: String,
    val kind: NoticeKind = NoticeKind.INFO,
    val actionLabel: String? = null,
    val onAction: (() -> Unit)? = null,
)

/** Durées de référence : `SnackbarDuration.Short` vaut ~4 s, `Long` ~10 s. */
const val NOTICE_SHORT_MS = 4_000
const val NOTICE_INFO_MS = 6_000
const val NOTICE_LONG_MS = 10_000

/**
 * Combien de temps une notice reste à l'écran.
 *
 * - avec une ACTION : [NOTICE_LONG_MS] — une action qu'on ne trouve pas est une
 *   action absente, donc une notice actionnable n'est jamais brève ;
 * - [NoticeKind.ERROR] : [NOTICE_LONG_MS] aussi, parce que c'est le message du
 *   serveur qu'il faut avoir le temps de lire (401, 503…) ;
 * - [NoticeKind.SUCCESS] : [NOTICE_SHORT_MS] — une confirmation constate, elle ne
 *   demande rien ;
 * - [NoticeKind.INFO] : [NOTICE_INFO_MS], entre les deux.
 *
 * ponytail: la durée est une FONCTION de la sévérité, donc « une erreur reste plus
 *   longtemps » ne peut pas diverger d'un écran à l'autre. Upgrade: suspendre la
 *   fermeture au doigt n'a pas d'équivalent ici.
 */
fun noticeDurationMs(kind: NoticeKind, hasAction: Boolean): Int = when {
    hasAction -> NOTICE_LONG_MS
    kind == NoticeKind.ERROR -> NOTICE_LONG_MS
    kind == NoticeKind.SUCCESS -> NOTICE_SHORT_MS
    else -> NOTICE_INFO_MS
}

/** `true` = `SnackbarDuration.Long`, `false` = `Short`. */
fun noticeIsLong(kind: NoticeKind, hasAction: Boolean): Boolean =
    noticeDurationMs(kind, hasAction) >= NOTICE_LONG_MS

/** Les trois couleurs d'une notice : fond, encre du texte, encre de l'action. */
data class NoticePalette(val container: Color, val content: Color, val action: Color)

/**
 * Couleurs d'une notice, par SÉVÉRITÉ — donc un échec ne peut pas ressembler à
 * une réussite.
 *
 * L'échec reprend EXACTEMENT le couple déjà mesuré d'un cours annulé
 * ([cancelledSurface] / [cancelledInk] : 7.3:1 en clair, 8.9:1 en sombre) : le
 * thème ne pose aucun rôle « surface d'erreur », donc on ne réinvente pas une
 * teinte, on réutilise le rouge de marque passé par le même [tint] que tout le
 * reste — en thème sombre comme en thème clair.
 *
 * Les deux autres sévérités prennent l'ENCRE NORMALE du thème sur la surface
 * variante. L'action y prend la même encre que le texte : `primary` sur
 * `surfaceVariant` ne mesure que 3.47:1, sous le 4.5:1 du corps de texte.
 *
 * ponytail: une seule couleur de fond « succès » n'existe pas dans le thème, et
 *   la créer serait du vert de matière sur une surface — la distinction tient à
 *   l'encre et au fond, qui sont mesurés.
 */
fun noticePalette(
    kind: NoticeKind,
    error: Color,
    dark: Boolean,
    surfaceVariant: Color,
    onSurface: Color,
): NoticePalette = when (kind) {
    NoticeKind.ERROR -> NoticePalette(
        container = cancelledSurface(error, dark),
        content = cancelledInk(error, dark),
        action = cancelledInk(error, dark),
    )
    else -> NoticePalette(container = surfaceVariant, content = onSurface, action = onSurface)
}

/** La palette de la notice, lue dans le thème (la fonction pure ci-dessus est
 *  celle que le miroir TS teste). */
@Composable
fun papNoticePalette(kind: NoticeKind): NoticePalette = noticePalette(
    kind = kind,
    error = MaterialTheme.colorScheme.error,
    dark = isDarkSurface(),
    surfaceVariant = MaterialTheme.colorScheme.surfaceVariant,
    onSurface = MaterialTheme.colorScheme.onSurface,
)

/**
 * Qui affiche les notices.
 *
 * `AppNav.kt` fournit l'implémentation branchée sur le `SnackbarHost` de la
 * coquille ; le bouchon ne fait RIEN, donc un écran composé hors de la racine ne
 * plante pas.
 */
interface PapNoticePoster {
    fun show(notice: PapNotice)

    /** Retire la notice en cours (l'utilisateur a changé d'écran, ou une écriture
     *  en a rendu une autre inutile). */
    fun dismiss()
}

private object SilentNoticePoster : PapNoticePoster {
    override fun show(notice: PapNotice) = Unit

    override fun dismiss() = Unit
}

/** Le poste de notices de l'écran courant : `LocalPapNotice.current`. */
val LocalPapNotice = staticCompositionLocalOf<PapNoticePoster> { SilentNoticePoster }

/**
 * Hôte du snackbar racine : l'état affiché, la sévérité PEINTE et le poster.
 *
 * `SnackbarHost` ne reçoit que `SnackbarData` — il ne peut donc pas savoir que
 * la notice courante est un échec — d'où la sévérité mémorisée ici au moment où
 * la notice est postée. Une seule notice à la fois : l'ancienne part avant que la
 * nouvelle n'arrive, sinon deux messages se chevauchent et le second actionnable
 * n'est plus atteignable.
 */
@Stable
class PapNoticeHost internal constructor(private val scope: CoroutineScope) : PapNoticePoster {
    internal val state = SnackbarHostState()
    internal var kind by mutableStateOf(NoticeKind.INFO)

    override fun show(notice: PapNotice) {
        scope.launch {
            state.currentSnackbarData?.dismiss()
            kind = notice.kind
            val result = state.showSnackbar(
                message = notice.text,
                actionLabel = notice.actionLabel,
                duration = if (noticeIsLong(notice.kind, notice.actionLabel != null)) {
                    SnackbarDuration.Long
                } else {
                    SnackbarDuration.Short
                },
            )
            if (result == SnackbarResult.ActionPerformed) notice.onAction?.invoke()
        }
    }

    override fun dismiss() {
        scope.launch { state.currentSnackbarData?.dismiss() }
    }
}

/** L'hôte, mémémorisé : son état doit survivre aux recompositions. */
@Composable
fun rememberPapNoticeHost(): PapNoticeHost {
    val scope = rememberCoroutineScope()
    return remember(scope) { PapNoticeHost(scope) }
}

/**
 * Le `SnackbarHost` de la coquille, peint dans la couleur de la sévérité.
 *
 * C'est le SEUL endroit du module où une notice est peinte : un écran poste, il ne
 * dessine pas.
 */
@Composable
fun PapNoticeSnackbarHost(host: PapNoticeHost, modifier: Modifier = Modifier) {
    SnackbarHost(hostState = host.state, modifier = modifier) { data ->
        val palette = papNoticePalette(host.kind)
        Snackbar(
            snackbarData = data,
            containerColor = palette.container,
            contentColor = palette.content,
            actionContentColor = palette.action,
            shape = MaterialTheme.shapes.small,
        )
    }
}
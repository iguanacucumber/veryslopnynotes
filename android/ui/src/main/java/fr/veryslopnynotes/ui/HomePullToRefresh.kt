package fr.veryslopnynotes.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalOverscrollConfiguration
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// TIRER POUR ACTUALISER, SANS BIBLIOTHÈQUE #143.
//
// POURQUOI ÉCRIRE 90 LIGNES : le pull-refresh Material est arrivé dans
// material3 1.3.0, or ce module est FIGÉ sur material3 1.2.1 / Compose BOM
// 2024.06.00 (garde-fou : `tests/unit/android-pap-components.test.ts`). L'ancien
// paquet `androidx.compose.material.pullrefresh` (celui de Material 2) n'est PAS
// dans le graphe, et l'ajouter serait une dépendance de plus, donc interdite.
// Reste `NestedScrollConnection`, qui est dans `androidx.compose.ui` et donc déjà
// là : de la plomberie, zéro dépendance.
//
// `LocalOverscrollConfiguration provides null` N'EST PAS décoratif : sur Android
// 12+, l'effet d'overscroll natif consomme le geste de rappel EN AMONT de cette
// connexion, et le tirail ne se produirait jamais. C'est exactement ce qu'un
// fournisseur de pull-refresh doit couper.
//
// ponytail: pas d'anneau de progression Material, la flèche tourne de l'angle
//   tiré puis en boucle pendant l'actualisation ; une classe privée pour la
//   connexion parce que l'état du geste doit survivre aux recompositions
//   (l'objet anonyme serait recréé à chaque `remember` invalidé).
// Upgrade: le `PullToRefreshBox` de material3 1.3.0 quand le BOM bougera — ce
//   composable devient alors un alias, et le reste de l'accueil n'y touche pas.

/** Distance de déclenchement : au-delà, relâcher actualise. */
private val PULL_TRIGGER = 72.dp

/** Garde-fou du geste : au-delà, la page ne descend plus (sinon elle décolle). */
private val PULL_MAX = 140.dp

/** Côte de la flèche indicatrice. */
private val PULL_INDICATOR = 24.dp

/** Durée du retour au repos. */
private const val PULL_BACK_MS = 240

/** Durée d'un tour de la flèche pendant l'actualisation. */
private const val PULL_SPIN_MS = 900

/**
 * La connexion de tirail.
 *
 * `pull` est l'état VRAI du geste, cumulé de façon SYNCHRONE : `Animatable.value`
 * n'a pas de setter public (`snapTo` est `suspend`), donc relire la valeur
 * animée à chaque événement perdrait la distance déjà tirée — un geste rapide
 * n'atteindrait jamais le seuil. L'`Animatable` ne sert donc qu'à AFFICHER
 * `pull` et à l'animer au retour.
 */
private class HomePullConnection(
    private val offset: Animatable<Float, AnimationVector1D>,
    private val scope: CoroutineScope,
    private val triggerPx: Float,
    private val maxPx: Float,
    private val isRefreshing: () -> Boolean,
    private val onRelease: () -> Unit,
) : NestedScrollConnection {
    private var pull = 0f

    private fun grow(delta: Float) {
        pull = (pull + delta).coerceAtMost(maxPx)
        scope.launch { offset.snapTo(pull) }
    }

    // La page est déjà descendue : on avale le geste, sinon le contenu
    // défilerait sous le doigt pendant qu'on l'attrape.
    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (isRefreshing() || available.y <= 0f || pull <= 0f) return Offset.Zero
        grow(available.y)
        return Offset(0f, available.y)
    }

    // Arrivée en haut de la page : ce qui reste vers le bas commence le tirail.
    // Le défilement interne n'a rien consommé, sinon il ne resterait rien ici.
    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
        if (isRefreshing() || available.y <= 0f || pull > 0f) return Offset.Zero
        grow(available.y)
        return Offset(0f, available.y)
    }

    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
        if (pull <= 0f) return Velocity.Zero
        val fire = pull >= triggerPx
        pull = 0f
        offset.animateTo(0f, tween(PULL_BACK_MS))
        if (fire && !isRefreshing()) onRelease()
        return Velocity.Zero
    }
}

/**
 * Page tire-en-bas-pour-actualiser, sans dépendance ajoutée.
 *
 * [refreshing] = une actualisation est EN COURS (le contenu ne bouge plus, la
 * flèche tourne) ; [onRefresh] n'est appelé qu'au relâchement AU-DELÀ de la
 * distance de déclenchement. Le contenu affiché n'est jamais retiré pendant
 * l'appel : c'est ce qui garantit qu'une actualisation ratée laisse la page en
 * place (#14 — le cache reste la source, l'échec ne fait que dater les données).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HomePullToRefresh(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val triggerPx = with(density) { PULL_TRIGGER.toPx() }
    val maxPx = with(density) { PULL_MAX.toPx() }
    val indicatorPx = with(density) { PULL_INDICATOR.toPx() }
    // La flèche tourne en boucle : ce `rotationZ` est lu dans le layer, donc la
    // boucle ne recompose rien d'autre que l'icône.
    val spin by rememberInfiniteTransition(label = "homePull").animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(PULL_SPIN_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "homePullSpin",
    )
    val latestOnRefresh by rememberUpdatedState(onRefresh)
    // #166 : `refreshing` passe par `rememberUpdatedState` comme `onRefresh`. La
    // connexion est mémorisée par `remember`, donc un `{ refreshing }` capturé
    // dans sa construction lit la valeur de la PREMIÈRE composition : pendant une
    // actualisation, `isRefreshing()` rendait `false` et le tirail pouvait
    // déclencher une DEUXIÈME requête par-dessus la première. Rare sur l'accueil,
    // plus fréquent sur l'EDT où la relecture est déclenchée par semaine et par
    // l'action de la barre du haut.
    val latestRefreshing by rememberUpdatedState(refreshing)
    val connection = remember(offset, scope, triggerPx, maxPx) {
        HomePullConnection(
            offset = offset,
            scope = scope,
            triggerPx = triggerPx,
            maxPx = maxPx,
            isRefreshing = { latestRefreshing },
            onRelease = { latestOnRefresh() },
        )
    }
    CompositionLocalProvider(LocalOverscrollConfiguration provides null) {
        Box(modifier = modifier.nestedScroll(connection)) {
            // Le déplacement est lu dans le lambda de layout : le geste ne
            // recompose pas la page entière.
            Box(modifier = Modifier.offset { IntOffset(0, offset.value.roundToInt()) }) { content() }
            if (offset.value > 0f || refreshing) {
                // Pendant l'actualisation, l'indicateur reste sous le bord haut :
                // le contenu ne descend pas, donc rien ne saute à l'écran.
                val top = if (refreshing) 0f else (offset.value - indicatorPx).coerceAtLeast(0f)
                Icon(
                    imageVector = Icons.Filled.Refresh,
                    contentDescription = if (refreshing) "Actualisation en cours" else null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .offset { IntOffset(0, top.roundToInt()) }
                        .size(PULL_INDICATOR)
                        .graphicsLayer {
                            rotationZ = if (refreshing) spin else offset.value * 360f / triggerPx.coerceAtLeast(1f)
                        },
                )
            }
        }
    }
}
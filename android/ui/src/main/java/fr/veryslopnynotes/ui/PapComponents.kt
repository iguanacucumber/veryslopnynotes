package fr.veryslopnynotes.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

// BRIQUES D'INTERFACE #136.
//
// PRÉSENTATION SEULEMENT : aucune donnée, aucun dépôt, aucun cache, aucune
// coroutine, aucune navigation. Chaque fonction est une fonction PURE de ses
// arguments — c'est ce qui les rend testables (`tests/unit/android-pap-components.test.ts`
// en est le miroir) et réutilisables par n'importe quel écran.
//
// AVANT, les mêmes besoins étaient réécrits 13 fois, chacun un peu différent :
//   - état vide = une phrase sans icône ni action (9 écrans) ;
//   - chargement = le mot « Chargement... » en `bodyMedium` (11 occurrences),
//     ZÉRO `CircularProgressIndicator` dans le module, aucun squelette ;
//   - erreur = la chaîne figée « Erreur réseau. Réessayer. » qui JETTE
//     `UiState.Error.message` (8 écrans) : le vrai message du serveur
//     n'était affiché nulle part ;
//   - périmé = « Données hors-ligne (périmé). » (8 écrans), sans couleur, sans
//     horodatage, sans action — alors que `UiState.Data.fetchedAt` est calculé
//     par tous les constructeurs et lu par AUCUN écran.
//
// #136 livre les briques ; la VAGUE SUIVANTE les adopte écran par écran. Aucun
// écran n'est touché ici : un composant qui n'a pas encore d'appelant ne prouve
// rien, et le test de non-régression de l'app (`make shot`) doit rester vert.
//
// ponytail: pas de bibliothèque de squelette ni de dates — `rememberInfiniteTransition`
// et `java.time` (minSdk 26) sont déjà là. Chaque couleur, chaque forme, chaque
// style vient de `PapillonTheme.kt` : AUCUN hex en dur dans ce fichier.

/** Épaisseur du filet, en dp. */
private val HAIRLINE = 1.dp

/** Espacement interne d'une carte. */
private val CARD_PADDING = 16.dp

/** Espacement interne d'un bandeau. */
private val BANNER_PADDING = 12.dp

/**
 * Opacité de l'icône d'un état vide.
 *
 * 50 %, le parti pris de papillon.bzh : l'icône d'un état vide est un glyphe
 * DÉCORATIF (`contentDescription = null`, c'est le titre qui porte le sens),
 * donc aucune règle de contraste ne s'y applique. Ce n'est pas un jeton de
 * couleur : l'appliquer SUR l'encre du thème (`onSurfaceVariant`) est
 * exactement ce que fait Papillon, où l'icône d'état vide est le gris le plus
 * pâle de l'écran.
 */
private const val EMPTY_ICON_ALPHA = 0.5f

/** Bornes d'opacité du squelette : la boîte respire entre les deux. */
private const val SKELETON_ALPHA_MIN = 0.30f
private const val SKELETON_ALPHA_MAX = 0.65f

/** Durée d'un aller-retour de pulsation. */
private const val SKELETON_PERIOD_MS = 900

/** Nombre de lignes du squelette de liste, quand l'écran n'en demande pas. */
private const val SKELETON_ROWS = 6

/** Pastille matière : la couleur de matière ramenée à 31 % au-dessus du fond. */
private const val AVATAR_TINT_ALPHA = 0.31f

/** Côte de la pastille matière. 44 dp avec un rayon de 20 reste un carré
 *  arrondi (44 / 2 = 22 > 20) ; 40 dp donnerait un disque. */
private val AVATAR_SIZE = 44.dp

/** Au-delà de ce compteur, la pastille affiche « 99+ » : un nombre à quatre
 *  chiffres déborde de l'onglet. */
private const val BADGE_MAX = 99

// --- Logique pure (testable sans téléphone, sans Compose) ---------------------

/** Une minute, en millisecondes. */
private const val MINUTE_MS = 60_000L

/** Une heure, en millisecondes. */
private const val HOUR_MS = 3_600_000L

/** Au-delà de 6 jours, une date lisible vaut mieux qu'une durée. */
private const val DAYS_BEFORE_DATE = 7L

/**
 * Fenêtre d'epoch retenue : `0001-01-02` → `9999-12-30` en UTC.
 *
 * Bornes POSÉES, pas une exception : `java.time` accepte `Long.MIN_VALUE` et
 * rend alors une année de -292 millions, que le motif `dd/MM/yyyy` ne sait pas
 * formater (le champ `YearOfEra` commence à 1). Voir [relativeTimeFr].
 *
 * La marge d'UN JOUR à chaque bout n'est pas décorative : le fuseau s'ajoute
 * APRÈS le bornage, et il va jusqu'à +14 h. Borné à `9999-12-31T23:59:59Z`,
 * l'appareil de test (fuseau +04) affichait donc « 01/01/+10000 » — une année à
 * cinq chiffres, que `yyyy` signe d'un `+` parce qu'elle dépasse quatre
 * chiffres. Un jour de marge suffit à garder l'année dans le motif, quel que
 * soit le fuseau.
 */
private const val MIN_EPOCH_MS = -62_135_510_400_000L
private const val MAX_EPOCH_MS = 253_402_128_000_000L

/** Date de repli, format français court. Format POSÉ, pas `MMM` : le nom court
 *  du mois dépend de la CLDR du téléphone (« oct. », « oct », « 10月 »). */
private val DATE_FR: DateTimeFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.FRANCE)

/** Heure seule, 24 h, sans fuseau ni locale à l'oral. */
private val CLOCK_FR: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE)

/**
 * Date en toutes lettres, pour la ligne de note de l'onglet Notes (#192).
 *
 * `d` sans zéro : la référence rend `{ day: 'numeric' }`, qui vaut « 5 », pas
 * « 05 ». Écrit avec la locale plutôt qu'avec des noms de mois en dur, donc le
 * mois vient de `java.time` et pas d'un tableau.
 */
private val LONG_DATE_FR: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.FRANCE)

/** Phrase de repli quand le serveur n'a rien dit d'utile. */
private const val GENERIC_ERROR = "Erreur réseau. Réessayer."

/** Phrase de repli du bandeau périmé, sans horodatage. */
private const val STALE_LABEL = "Données hors-ligne"

/**
 * Texte d'une erreur : le VRAI message du serveur s'il en a donné un, sinon la
 * phrase de repli.
 *
 * C'est le correctif de #136 : huit écrans affichaient « Erreur réseau.
 * Réessayer. » en jetant `UiState.Error.message`, donc l'utilisateur ne
 * voyait jamais ce que le serveur avait réellement répondu (« 401 session
 * expirée », « 503 service indisponible »…). Un message VIDE ou fait
 * d'espaces est traité comme absent : une étiquette vide vaut moins que la
 * phrase de repli.
 */
fun errorHeadline(message: String?): String =
    message?.trim()?.takeIf { it.isNotEmpty() } ?: GENERIC_ERROR

/**
 * Durée en français, en temps relatif : « à l'instant », « il y a 4 min »,
 * « il y a 3 h », « hier 08:00 », « demain 08:00 », « il y a 6 jours », puis une
 * date.
 *
 * [now] et [zone] sont INJECTÉS (valeurs par défaut = l'heure et le fuseau du
 * téléphone) : « hier » et « aujourd'hui » dépendent du FUSEAU, donc sans ces
 * deux paramètres la fonction n'est pas déterministe et n'est pas testable.
 * Cf. le miroir TS, qui passe un fuseau explicite.
 *
 * Unités françaises : `min` et `h` sont des abréviations INVARIANTES (« 1 min »
 * comme « 4 min »), donc aucun pluriel à écrire ; « jours » ne porte jamais le
 * singulier ici, un jour entier étant déjà dit « hier » / « demain ».
 *
 * Le seuil « même journée » passe APRÈS les seuils minute/heure : à 00 h 10,
 * une donnée de la veille à 23 h 55 vaut « il y a 15 min », pas « hier 23:55 »,
 * et la première est l'information utile d'un horodatage de synchronisation.
 *
 * Les deux bornes [MIN_EPOCH_MS] / [MAX_EPOCH_MS] ne sont pas décoratives : la
 * valeur vient d'un fichier de cache lu par `toLongOrNull`
 * (`OfflineCache.kt`), qui accepte N'IMPORTE QUEL `Long`. Bornée, la
 * soustraction ne peut plus déborder et `dd/MM/yyyy` a toujours une année à
 * rendre ; non bornée, `Long.MIN_VALUE` fait tomber l'écran au milieu d'un
 * rendu. Au pire on affiche « 01/01/0001 » : un horodatage qu'on ne comprend
 * pas vaut mieux qu'un écran mort.
 *
 * ponytail: pas de bibliothèque de dates (date-fns, ThreeTen…), `java.time`
 * suffit (minSdk 26 = API 26, donc le désucrage n'est même pas nécessaire).
 * Upgrade: une heure d'été qui tombe entre l'écriture et l'affichage — c'est
 * la seule chose que le formatage ne peut pas trancher, l'horodatage est déjà
 * en UTC.
 */
fun relativeTimeFr(
    epochMillis: Long,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): String {
    val epoch = epochMillis.coerceIn(MIN_EPOCH_MS, MAX_EPOCH_MS)
    val anchor = now.coerceIn(MIN_EPOCH_MS, MAX_EPOCH_MS)
    val delta = epoch - anchor
    val gap = if (delta < 0) -delta else delta
    val past = delta < 0
    if (gap < MINUTE_MS) return "à l'instant"
    val minutes = gap / MINUTE_MS
    if (minutes < 60) return if (past) "il y a $minutes min" else "dans $minutes min"
    val hours = gap / HOUR_MS
    val there = Instant.ofEpochMilli(epoch).atZone(zone)
    val today = Instant.ofEpochMilli(anchor).atZone(zone).toLocalDate()
    val day = there.toLocalDate()
    if (day == today) return if (past) "il y a $hours h" else "dans $hours h"
    val clock = CLOCK_FR.format(there)
    if (past && day == today.minusDays(1)) return "hier $clock"
    if (!past && day == today.plusDays(1)) return "demain $clock"
    val days = ChronoUnit.DAYS.between(minOf(day, today), maxOf(day, today))
    if (days < DAYS_BEFORE_DATE) return if (past) "il y a $days jours" else "dans $days jours"
    return DATE_FR.format(there)
}

/**
 * Date d'une note, EN TOUTES LETTRES : « 5 octobre 2026 ».
 *
 * #192 : la ligne de note de la référence n'affiche pas une date relative. Elle
 * rend `{ day: 'numeric', month: 'long', year: 'numeric' }` — donc un quantitatif,
 * un mois en lettres, l'année, et RIEN d'autre (pas d'heure, pas de « il y a »).
 * Notre ligne rendait « il y a 3 jours », ce qui est une information de SYNCHRO
 * (elle parle de l'horloge) et pas de la note : deux notes du même jour
 * seraient indiscernables, et une note de septembre et une de septembre de
 * l'an passé donneraient la même chaîne.
 *
 * Le format estchosen à la main parce qu'il n'a pas de nom : `LL` n'a pas de
 * forme locale fiable en `java.time` pour les mois français. `MMMM` sur
 * `Locale.FRANCE` donne bien « octobre », et le quantitatif `d` n'a pas de
 * zéro — d'où `"d MMMM yyyy"` et non `"dd MMMM yyyy"`, qui afficherait « 05 ».
 *
 * Borné comme [relativeTimeFr] : la valeur vient d'un cache lu en `Long`.
 */
fun longDateFr(
    epochMillis: Long,
    zone: ZoneId = ZoneId.systemDefault(),
): String = LONG_DATE_FR.format(Instant.ofEpochMilli(epochMillis.coerceIn(MIN_EPOCH_MS, MAX_EPOCH_MS)).atZone(zone))

/**
 * Texte du bandeau « périmé » : la phrase figée des huit écrans, PLUS
 * l'horodatage quand on le connaît.
 *
 * `fetchedAt = null` (aucune synchronisation mémorisée) = la phrase seule : pas
 * de date inventée. Sinon « Données hors-ligne · mis à jour il y a 4 min ».
 */
fun staleBannerLabel(fetchedAt: Long?, now: Long = System.currentTimeMillis()): String =
    if (fetchedAt == null) STALE_LABEL else "$STALE_LABEL · mis à jour ${relativeTimeFr(fetchedAt, now)}"

// --- Briques ----------------------------------------------------------------

/**
 * Carte : rayon 20 dp ([MaterialTheme.shapes] de #134), 1 dp d'élévation, et un
 * FILET plutôt qu'une ombre.
 *
 * Sur Android, une ombre à 1 dp est invisible (elle se noie dans le fond) et
 * coûte un calque de rendu ; papillon.bzh pose donc une bordure. `border = null`
 * rend la carte sans filet, pour le cas où le parent en fournit un.
 *
 * [onClick] nul = carte non cliquable, donc pas de `Indication` parasite ni de
 * min-height d'appui.
 */
@Composable
fun PapCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    containerColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    border: BorderStroke? = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outline),
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = CardDefaults.cardColors(containerColor = containerColor)
    val shape = MaterialTheme.shapes.large
    val elevation = CardDefaults.cardElevation(defaultElevation = HAIRLINE)
    if (onClick == null) {
        Card(modifier = modifier, shape = shape, colors = colors, elevation = elevation, border = border) {
            Column(modifier = Modifier.padding(CARD_PADDING), content = content)
        }
    } else {
        Card(
            onClick = onClick,
            modifier = modifier,
            shape = shape,
            colors = colors,
            elevation = elevation,
            border = border,
        ) {
            Column(modifier = Modifier.padding(CARD_PADDING), content = content)
        }
    }
}

/** Filet 1 dp. La couleur est le rôle `outlineVariant` du thème, c'est-à-dire
 *  exactement l'opacité 13 % demandée, en clair comme en sombre. */
@Composable
fun PapDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(modifier = modifier, thickness = HAIRLINE, color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * Titre de section : icône + titre, tous deux en encre secondaire.
 *
 * Le thème compose déjà `onSurfaceVariant` à [PapillonSecondaryAlpha], la valeur
 * MESURÉE qui repasse AA (4.76:1 sur blanc, 7.6:1 sur la surface sombre). On
 * l'utilise telle quelle : poser 60 % en dur au-dessus donnerait 0.39
 * d'opacité effective et 2.9:1 — l'icône de section redeviendrait le texte le
 * moins lisible de l'écran. Le parti pris de Papillon (« moins saillant que le
 * corps ») est respecté, avec la valeur qui passe le contraste.
 *
 * [count] s'affiche après le titre (une pastille, pas un chiffre collé au mot),
 * [action] est le point d'accroche du bouton de droite — vide partout aujourd'hui.
 */
@Composable
fun PapSectionHeader(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val tint = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Décoratif : le titre porte le sens, donc l'icône est annoncée nulle.
        Icon(imageVector = icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        // `heading()` : c'est le repère de navigation qu'un lecteur d'écran
        // cherche (« titres » dans TalkBack). AVANT #146, l'en-tête de section
        // n'était qu'un texte : la seule façon de survoler un écran était de
        // le lire ligne à ligne.
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false).semantics { heading() },
        )
        if (count != null && count > 0) {
            Text(text = "$count", style = MaterialTheme.typography.labelMedium, color = tint)
        }
        action?.invoke()
    }
}

/**
 * Ligne de liste : [leading] (pastille, icône), titre, sous-titre optionnel,
 * [trailing] (valeur, chevron, bouton).
 *
 * On ne rend RIEN si le titre est vide : une ligne sans titre est un aplat, pas
 * une information.
 */
@Composable
fun PapListItem(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    if (title.isEmpty()) return
    Row(
        modifier = modifier
            .fillMaxWidth()
            // `role = Role.Button` : la ligne ouvre une destination, donc un
            // lecteur d'écran doit l'annoncer comme un bouton — un `Row` cliquable
            // sans rôle se fait annoncer comme du texte qu'on active.
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = CARD_PADDING, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        leading?.invoke()
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrEmpty()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing?.invoke()
    }
}

/**
 * État vide : icône à 50 %, titre en gras centré, description centrée, action
 * optionnelle. La forme de papillon.bzh.
 *
 * [description] peut être vide (pas de phrase de remplissage) ; l'icône est
 * décorative, donc annoncée nulle.
 */
@Composable
fun PapEmptyState(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(48.dp).alpha(EMPTY_ICON_ALPHA),
        )
        // Titre de l'état vide = le seul titre de l'écran : il porte `heading()`
        // pour qu'un lecteur d'écran sache où il est sans lire la description.
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        if (description.isNotEmpty()) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        if (action != null) {
            Box(modifier = Modifier.padding(top = 8.dp)) { action() }
        }
    }
}

/**
 * État d'erreur : le VRAI message du serveur, un bouton « Réessayer », et le
 * détail technique DERNIÈRE un dépliant « Détails » (jamais jeté, jamais imposed
 * sous le pouce).
 *
 * [message] est le texte À destination de l'utilisateur — celui de
 * `UiState.Error.message`, qui voyait la chaîne figée avant. [detail] est le
 * complément technique que l'écran a sous la main (corps HTTP, exception) :
 * s'il est vide, aucun dépliant n'apparaît.
 *
 * [errorHeadline] applique la règle de priorité : le message réel gagne, une
 * chaîne vide ou blanche retombe sur la phrase de repli.
 */
@Composable
fun PapErrorState(
    message: String?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Warning,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(40.dp),
        )
        Text(
            text = errorHeadline(message),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        if (!detail.isNullOrBlank()) {
            TextButton(onClick = { expanded = !expanded }) {
                Text(if (expanded) "Masquer les détails" else "Détails")
            }
            if (expanded) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
        Button(
            onClick = onRetry,
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Text("Réessayer")
        }
    }
}

/**
 * Squelette de liste : des boîtes qui pulsent en opacité, une par ligne.
 *
 * AVANT #136, le chargement était le mot « Chargement... » en `bodyMedium` dans
 * onze écrans : la mise en page sautait à l'arrivée des données, et rien
 * n'annonçait qu'il y avait des lignes en chemin. Un squelette occupe la place
 * finale, donc rien ne bouge quand les données arrivent.
 *
 * Animation par [rememberInfiniteTransition] (déjà dans le BOM) : pas de
 * bibliothèque de shimmer, donc AUCUNE dépendance ajoutée. Le tout est annoncé
 * une fois aux lecteurs d'écran (« Chargement en cours ») au lieu de laisser
 * lire des boîtes vides.
 */
@Composable
fun PapLoading(modifier: Modifier = Modifier, rows: Int = SKELETON_ROWS) {
    val pulse by rememberInfiniteTransition(label = "papSkeleton").animateFloat(
        initialValue = SKELETON_ALPHA_MIN,
        targetValue = SKELETON_ALPHA_MAX,
        animationSpec = infiniteRepeatable(
            animation = tween(SKELETON_PERIOD_MS),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "papSkeletonAlpha",
    )
    val count = rows.coerceIn(1, 20)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clearAndSetSemantics { contentDescription = "Chargement en cours" },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        for (row in 0 until count) {
            PapSkeletonRow(pulse = pulse, wide = row % 2 == 0)
        }
    }
}

/** Une ligne de squelette : une pastille carrée et deux barres de texte. */
@Composable
private fun PapSkeletonRow(pulse: Float, wide: Boolean) {
    val box = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = pulse)
    val shape = MaterialTheme.shapes.large
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(AVATAR_SIZE).clip(shape).background(box))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(if (wide) 0.7f else 0.5f)
                    .height(14.dp)
                    .clip(shape)
                    .background(box),
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.35f)
                    .height(10.dp)
                    .clip(shape)
                    .background(box),
            )
        }
    }
}

/**
 * Chargement d'UN bloc : un `CircularProgressIndicator` centré.
 *
 * Le module n'en avait AUCUN (`grep CircularProgressIndicator` = 0 avant #136) :
 * un indicateur de progression est réservé au cas « on ne sait pas combien de
 * lignes arriveront », le reste passe par [PapLoading].
 */
@Composable
fun PapLoadingBlock(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxWidth().padding(24.dp).clearAndSetSemantics {
            contentDescription = "Chargement en cours"
        },
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(28.dp),
            color = MaterialTheme.colorScheme.primary,
            strokeWidth = 3.dp,
        )
    }
}

/**
 * Bandeau « données périmées » : la phrase figée des huit écrans, PLUS une
 * couleur, PLUS « mis à jour il y a 4 min », PLUS une action « Actualiser ».
 *
 * `fetchedAt` vient de `UiState.Data.fetchedAt`, que tous les constructeurs
 * calculaient et qu'aucun écran ne lisait : l'utilisateur ne pouvait pas savoir
 * quand ses données dataient.
 *
 * Couleurs : le thème ne pose AUCUN rôle « avertissement », donc le bandeau
 * prend l'appariement `primaryContainer` / `onPrimaryContainer` — posé dans les
 * deux schemes, donc correct en mode sombre sans aucune couleur claire en dur.
 * Données périmées = information (« voici l'âge de ce que tu lis »), pas erreur :
 * le rouge de `error` serait une faute de ton.
 *
 * ponytail: upgrade = poser un rôle `warningContainer` dans `PapillonTheme.kt`
 * quand une référence Papillon le donne ; ici on n'invente pas de rôle.
 */
@Composable
fun PapStaleBanner(
    fetchedAt: Long?,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val container = MaterialTheme.colorScheme.primaryContainer
    val content = MaterialTheme.colorScheme.onPrimaryContainer
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .background(container)
            .padding(horizontal = BANNER_PADDING, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(imageVector = Icons.Filled.Warning, contentDescription = null, tint = content, modifier = Modifier.size(20.dp))
        Text(
            text = staleBannerLabel(fetchedAt),
            style = MaterialTheme.typography.bodySmall,
            color = content,
            modifier = Modifier.weight(1f),
        )
        TextButton(
            onClick = onRefresh,
            colors = ButtonDefaults.textButtonColors(contentColor = content),
        ) {
            Icon(imageVector = Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
            Text(text = "Actualiser", modifier = Modifier.padding(start = 4.dp))
        }
    }
}

/**
 * Puce texte sur une couleur de matière.
 *
 * Fond et encre sortent des MÊMES pas que les deux fonctions de matière de
 * `PapillonTheme.kt` : [tint] à 75 % vers le blanc (le pastel derrière le
 * libellé) et à −45 % vers le noir (l'encre mesurée qui repasse 4.5:1 sur les
 * 20 couleurs) en thème CLAIR. #179 : en thème SOMBRE les deux pas sont
 * INVERSÉS (60 % vers le noir, 55 % vers le blanc) — un pastel clair posé sur
 * un fond noir, avec une encre assombrie dessus, était illisible. Le pas vient
 * du thème, donc une pastille de note, une pastille « en cours » et une
 * pastille d'absence se rééquilibrent ensemble.
 */
@Composable
fun PapPill(text: String, color: Color, modifier: Modifier = Modifier) {
    if (text.isEmpty()) return
    val dark = isDarkSurface()
    Box(
        modifier = modifier
            .clip(MaterialTheme.shapes.small)
            .background(tint(color, if (dark) SUBJECT_SURFACE_DARK_TINT else SUBJECT_SURFACE_TINT))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = tint(color, if (dark) SUBJECT_CONTENT_DARK_TINT else SUBJECT_CONTENT_LIGHT_TINT),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Pastille matière : carré arrondi (rayon 20 dp) teinté à 31 % de la couleur,
 * emoji centré.
 *
 * 31 % n'est pas une convention : c'est l'alpha qui garde l'emoji lisible sur
 * le fond pastel sans le laver. L'encre n'a pas à être choisie ici — il n'y a
 * pas de texte, seulement un glyphe — donc le risque de contraste du `ponytail:`
 * de [PapPill] ne se pose pas.
 *
 * [emoji] vide = pastille vide (la matière n'a pas d'emoji), pas d'initiales
 * inventées : le libellé reste porté par la ligne, en toutes lettres.
 */
@Composable
fun PapSubjectAvatar(
    emoji: String?,
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = AVATAR_SIZE,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(MaterialTheme.shapes.large)
            .background(color.copy(alpha = AVATAR_TINT_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        if (!emoji.isNullOrEmpty()) {
            // L'emoji est DÉCORATIF : le libellé de la matière est toujours
            // affiché en toutes lettres à côté (cf. `SubjectStyle.badge`), donc
            // laisser TalkBack nommer le glyphe ne ferait qu'annoncer deux fois
            // la même information — et en français, avec un nom d'emoji obscur.
            Text(
                text = emoji,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.clearAndSetSemantics { },
            )
        }
    }
}

/**
 * Pastille de compteur : le slot que la barre d'onglets attend déjà
 * (`BadgedBox` dans `AppShell.kt`). `count <= 0` ne rend RIEN.
 *
 * Couleurs par défaut de `Badge`, donc les rôles `error` / `onError` du thème.
 * Au-delà de [BADGE_MAX], « 99+ » : un compteur à quatre chiffres déborde de
 * l'onglet.
 */
@Composable
fun PapBadge(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Badge(modifier = modifier) {
        Text(text = if (count > BADGE_MAX) "$BADGE_MAX+" else "$count")
    }
}

/**
 * Confirmation obligatoire d'une action DESTRUCTRICE.
 *
 * Avant #136, « Supprimer la discussion » et « Se déconnecter » se faisaient en
 * une seule pression : une discussion entière, ou la session appairée,
 * disparaissaient sur un appui perdu. Un dialogue n'est pas une bulle posée
 * partout — c'est le PRIX d'un geste irréversible.
 *
 * [destructive] passe le libellé de confirmation en `error` (rouge de marque) ;
 * [dismissLabel] est le libellé d'annulation, « Annuler » par défaut.
 */
@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    dismissLabel: String = "Annuler",
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.extraLarge,
        title = { Text(text = title, style = MaterialTheme.typography.titleMedium) },
        text = { Text(text = text, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                // #146 : `errorTextColor()` et `secondary` — les deux rôles bruts
                // sont des aplats : 3.70:1 pour le rouge sur la surface sombre et
                // 3.74:1 pour le vert de marque sur la claire, donc le bouton de
                // confirmation d'une suppression était sous AA dans les deux
                // thèmes (et le confirmant d'un dialogue est du texte de 14 sp).
                colors = ButtonDefaults.textButtonColors(
                    contentColor = if (destructive) {
                        errorTextColor()
                    } else {
                        MaterialTheme.colorScheme.secondary
                    },
                ),
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(dismissLabel) } },
    )
}
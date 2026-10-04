package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SecurityAlertsRepository
import fr.veryslopnynotes.data.SyncedRepository

// Écran Alertes sécurité (#21, I6) : liste d'injections neutralisées.
//
// CONTENU SUSPECT = DONNÉE, JAMAIS INSTRUCTION (I6, et c'est le sujet de cet
// écran) : `excerpt` est rendu par `Text` seul, jamais interprété. Ni WebView,
// ni `Html.fromHtml`, ni `AnnotatedString` HTML, ni lien cliquable, ni exécution.
// Le seul `Text` qui ressemble à une consigne est celui de l'extrait, et il est
// précédé de « Donnée suspecte (non exécutée) : ».
//
// #144 — le défaut de fond était l'OFFLINE : rien n'était mis en cache, donc
// hors ligne la liste était VIDE et l'écran affichait « Aucune alerte. Bon
// signe. » — l'utilisateur ne pouvait pas distinguer « aucune menace » de
// « pas de réseau », ce qui est la pire confusion possible sur l'écran qui existe
// pour montrer une menace. D'où trois états distincts, et une décision pure qui les départage :
//   - `AlertsView.Ready` FRAIS et vide  -> carte verte « Aucune alerte » ;
//   - `AlertsView.Ready` PÉRIMÉ et vide -> « pas de vérification » (pas de
//     carte verte : l'absence d'alerte ne peut pas être affirmée) ;
//   - `AlertsView.Failed`               -> le VRAI message du serveur.
//
// ponytail: la décision d'affichage est une fonction PURE (`alertsLayout`), donc
// elle se teste sans téléphone ; le rendu ne fait que la lire.
// Upgrade: ViewModel + Flow quand les autres écrans en auront un.

/** Nombre de caractères d'extrait affichés avant le dépliant « Afficher plus ». */
private const val EXCERPT_COLLAPSED = 140

/**
 * Ce que l'écran sait sur les alertes.
 *
 * [Ready.stale] = la liste affichée ne vient PAS d'une réponse fraîche du
 * serveur : repli cache, ou relecture échouée alors que le cache est là. Sans ce
 * drapeau, « liste vide » ne veut rien dire — c'est exactement le défaut hors
 * ligne que #144 corrige.
 */
sealed interface AlertsView {
    data object Loading : AlertsView

    data class Ready(
        val alerts: List<SecurityAlert>,
        val stale: Boolean,
        val fetchedAt: Long?,
    ) : AlertsView

    data class Failed(val message: String) : AlertsView
}

/**
 * Ce que l'écran MONTRE — la distinction « aucune menace » / « pas de réseau ».
 *
 * Elle est pure et testable : c'est elle qui garantit qu'une liste vide jamais
 * consultée ne soit jamais rendue comme un « bon signe ».
 */
enum class AlertsLayout { LOADING, ALL_CLEAR, OFFLINE_EMPTY, LIST, ERROR }

/** Décision d'affichage : jamais de carte verte sur une liste périmée. */
fun alertsLayout(view: AlertsView): AlertsLayout = when (view) {
    AlertsView.Loading -> AlertsLayout.LOADING
    is AlertsView.Failed -> AlertsLayout.ERROR
    is AlertsView.Ready -> when {
        view.alerts.isNotEmpty() -> AlertsLayout.LIST
        view.stale -> AlertsLayout.OFFLINE_EMPTY
        else -> AlertsLayout.ALL_CLEAR
    }
}

/** Gravité d'une alerte : couleur de la pastille de la carte. */
enum class AlertSeverity { DANGER, INFO }

/**
 * Gravité déduite du `kind` RÉEL, jamais d'une phrase figée (« Injection
 * neutralisée » pour tout, quel que soit le champ).
 *
 * `injection_neutralized` est la seule valeur que le contrat publie aujourd'hui
 * (`SecurityAlert.isValid` refuse les autres) : `INFO` n'est pas mort pour autant,
 * le contrat étant add-only, et un `kind` inconnu ne doit pas être peint en
 * rouge — il doit être peint en information.
 */
fun alertSeverity(kind: String): AlertSeverity =
    if (kind == SecurityAlert.KIND_INJECTION) AlertSeverity.DANGER else AlertSeverity.INFO

/** Libellé FRANÇAIS du `kind` : jamais le jeton brut du serveur à l'écran. */
fun alertKindLabel(kind: String): String = when (alertSeverity(kind)) {
    AlertSeverity.DANGER -> "Injection neutralisée"
    AlertSeverity.INFO -> "Alerte de sécurité"
}

/**
 * Libellé FRANÇAIS de la source du pipeline (`revision`, `homework`,
 * `manuals` sont des jetons ANGLAIS du contrat : les afficher tels quels était un
 * défaut). Source inconnue = « Autre source » : le nom brut ne part jamais dans
 * l'interface.
 */
fun alertSourceLabel(source: String): String = when (source) {
    "revision" -> "Fiches de révision"
    "homework" -> "Devoirs"
    "manuals" -> "Manuels"
    else -> "Autre source"
}

/** Extrait condensé pour l'état replié : coupe au MOT le plus proche. */
fun excerptPreview(excerpt: String, max: Int = EXCERPT_COLLAPSED): String {
    val clean = SecurityAlert.sanitizeExcerpt(excerpt)
    if (clean.length <= max) return clean
    val cut = clean.take(max)
    val lastSpace = cut.lastIndexOf(' ')
    return (if (lastSpace > max / 2) cut.substring(0, lastSpace) else cut).trimEnd() + "…"
}

/** Payload (cache ou réseau) -> alertes. Absent/illisible = liste vide propre. */
fun alertsFromPayload(payload: String?): List<SecurityAlert> = try {
    if (payload == null) emptyList() else SecurityAlertsRepository.parse(payload)
} catch (_: Exception) {
    emptyList()
}

@Composable
fun SecurityAlertsScreen(
    view: AlertsView,
    notice: String? = null,
    onRefresh: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Témoin d'écran de la route `alerts` (`shot.sh`) : la nature de la
        // liste doit rester lisible sur la capture, pas seulement dans le source.
        Text(
            text = "Injections neutralisées (données, jamais exécutées).",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        // Échec de la RELECTURE alors que le cache est là : la liste reste
        // affichée, la cause passe en une ligne (mêmes replis que l'onglet Notes).
        // #145 : c'est un REFUS, pas une information — il prend la couleur
        // d'erreur. En encre secondaire, il se lisait comme la ligne du témoin
        // juste au-dessus, donc un échec ne se distinguait d'aucun succès.
        if (notice != null) {
            // `errorTextColor()` : le rouge de marque ne vaut que 3.70:1 sur la
            // surface SOMBRE, et ce refus est du texte.
            Text(
                text = notice,
                style = MaterialTheme.typography.bodySmall,
                color = errorTextColor(),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        when (alertsLayout(view)) {
            AlertsLayout.LOADING -> PapLoading()
            AlertsLayout.ERROR -> PapErrorState(
                message = (view as? AlertsView.Failed)?.message,
                onRetry = onRefresh,
            )
            AlertsLayout.OFFLINE_EMPTY -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val stale = view as? AlertsView.Ready
                if (stale != null) {
                    PapStaleBanner(fetchedAt = stale.fetchedAt, onRefresh = onRefresh)
                }
                PapEmptyState(
                    icon = Icons.Filled.Info,
                    title = "Pas de vérification hors ligne",
                    description = "Le serveur n'a pas répondu et aucune alerte n'est en cache. " +
                        "L'absence d'alerte ne peut donc pas être affirmée : réessayez une fois connecté.",
                    action = { Button(onClick = onRefresh) { Text("Réessayer") } },
                )
            }
            AlertsLayout.ALL_CLEAR -> AllClearCard()
            AlertsLayout.LIST -> {
                val ready = view as? AlertsView.Ready
                if (ready != null && ready.stale) {
                    PapStaleBanner(fetchedAt = ready.fetchedAt, onRefresh = onRefresh)
                }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(ready?.alerts ?: emptyList(), key = { it.id }) { alert ->
                        SecurityAlertCard(alert)
                    }
                }
            }
        }
    }
}

/**
 * Carte « bon signe » : vert de marque (`primaryContainer` / `onPrimaryContainer`),
 * coche et titre en gras.
 *
 * C'est la forme que Papillon utilise pour son « Aucune heure injustifiée » : un
 * aplat de SUCCÈS, pas une phrase grise au milieu d'un écran vide. Elle ne
 * s'affiche que sur une réponse fraîche du serveur (cf. [alertsLayout]).
 */
@Composable
private fun AllClearCard(modifier: Modifier = Modifier) {
    val container = MaterialTheme.colorScheme.primaryContainer
    val content = MaterialTheme.colorScheme.onPrimaryContainer
    PapCard(
        modifier = modifier.fillMaxWidth(),
        containerColor = container,
        // Pas de filet : l'aplat vert EST le cadre. Un `outline` gris par-dessus
        // une carte de succès ferait une seconde couleur sur la même forme.
        border = null,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                // Décoratif : le titre porte le sens.
                contentDescription = null,
                tint = content,
                modifier = Modifier.size(28.dp),
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                // `heading()` : le seul titre de cet état.
                Text(
                    text = "Aucune alerte de sécurité",
                    style = MaterialTheme.typography.titleMedium,
                    color = content,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    text = "Bon signe : le serveur n'a signalé aucun contenu hostile.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = content,
                )
            }
        }
    }
}

/**
 * Carte d'une alerte : gravité colorée, `kind` RÉEL, source traduite, extrait
 * dépliable.
 *
 * L'extrait est la donnée suspecte : elle est bornée par
 * [SecurityAlert.sanitizeExcerpt] (500 caractères) puis, repliée, par
 * [excerptPreview]. Elle reste du `Text` — un extrait d'injection qui contient
 * « ignores les instructions ci-dessous » n'est ni exécuté, ni cliquable, ni
 * interpreté.
 */
@Composable
fun SecurityAlertCard(alert: SecurityAlert, modifier: Modifier = Modifier) {
    val severity = alertSeverity(alert.kind)
    val accent: Color = if (severity == AlertSeverity.DANGER) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.primary
    }
    val excerpt = SecurityAlert.sanitizeExcerpt(alert.excerpt)
    val collapsible = excerpt.length > EXCERPT_COLLAPSED
    var expanded by remember(alert.id) { mutableStateOf(false) }
    PapCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // La couleur de gravité EST celle de la pastille : rouge de
                // marque pour une injection, vert pour une alerte d'information.
                PapPill(text = alertKindLabel(alert.kind), color = accent)
                PapPill(text = alertSourceLabel(alert.source), color = MaterialTheme.colorScheme.primary)
            }
            // `heading()` : titre du bloc d'extrait.
            Text(
                text = "Donnée suspecte (non exécutée) :",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            PapDivider()
            Text(
                text = if (expanded || !collapsible) excerpt else excerptPreview(excerpt),
                style = MaterialTheme.typography.bodyMedium,
            )
            if (collapsible) {
                TextButton(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "Réduire l'extrait" else "Afficher plus")
                }
            }
        }
    }
}

/**
 * Route alertes : cache synchrone au premier rendu, relecture réseau, repli
 * cache.
 *
 * #144 : AVANT, `SecurityAlertsRoute` ne gardait QUE son état local et
 * `error = "network"`, une chaîne que l'écran n'affichait jamais — hors ligne,
 * l'utilisateur lisait « Aucune alerte. Bon signe. », sans cache ni bandeau. Le
 * cache vient maintenant de la politique partagée (`CachePolicy.SECURITY_ALERTS`),
 * donc c'est le MÊME stockage que les notes ou l'EDT, et le bandeau « hors ligne »
 * porte son horodatage ([PapStaleBanner]).
 */
@Composable
fun SecurityAlertsRoute(
    repo: SyncedRepository,
    baseUrl: String,
) {
    val cached = remember {
        try {
            repo.cached(CachePolicy.SECURITY_ALERTS)
        } catch (_: Exception) {
            null
        }
    }
    var alerts by remember { mutableStateOf(alertsFromPayload(cached?.payload)) }
    var fetchedAt by remember { mutableStateOf(cached?.fetchedAt) }
    var stale by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    fun refresh() {
        // Serveur non configuré : aucun appel (I1), pas de cache = pas d'all-clear.
        if (baseUrl.isBlank()) {
            error = "Serveur non configuré."
            return
        }
        loading = true
        try {
            repo.refreshAsync(CachePolicy.SECURITY_ALERTS, baseUrl) { o ->
                when (o) {
                    is RefreshOutcome.Updated -> {
                        alerts = alertsFromPayload(o.payload)
                        fetchedAt = o.fetchedAt
                        stale = false
                        error = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        alerts = alertsFromPayload(o.payload)
                        fetchedAt = o.fetchedAt
                        stale = true
                        error = null
                    }
                    is RefreshOutcome.Failed -> {
                        // Échec AVEC cache : la liste reste affichée, la cause
                        // passe en bandeau (jamais jetée, cf. #136).
                        alerts = alertsFromPayload(o.cachedPayload)
                        error = o.message
                        stale = true
                    }
                }
                loading = false
            }
        } catch (_: Exception) {
            error = "Erreur inattendue."
            loading = false
        }
    }

    // Relecture au montage + au PullToRefresh : cette route n'a pas d'action
    // « Actualiser » dans la barre (cf. `TOP_BAR_ACTIONS`), donc pas de compteur
    // à câbler ici.
    LaunchedEffect(Unit) { refresh() }

    // Liste VIDE jamais consultée = chargement, PAS « bon signe » : c'est la
    // correction même du défaut hors ligne.
    val failure = error
    val view: AlertsView = when {
        failure != null && alerts.isEmpty() -> AlertsView.Failed(failure)
        alerts.isEmpty() -> AlertsView.Loading
        else -> AlertsView.Ready(alerts, stale = stale || failure != null, fetchedAt = fetchedAt)
    }

    HomePullToRefresh(refreshing = loading, onRefresh = { refresh() }) {
        SecurityAlertsScreen(view = view, notice = error, onRefresh = { refresh() })
    }
}
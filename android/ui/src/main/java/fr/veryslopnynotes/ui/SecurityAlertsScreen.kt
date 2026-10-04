package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.SecurityAlert

// Écran Alertes sécurité (#21, I6) : liste d'injections neutralisées.
// Contenu suspect affiché comme donnée via Text() seul, jamais interprété :
// pas de WebView, pas de Html.fromHtml, pas de AnnotatedString HTML,
// pas de lien cliquable, pas d'exécution. Préfixe explicite "donnée".
@Composable
fun SecurityAlertsScreen(
    alerts: List<SecurityAlert>,
    isLoading: Boolean = false,
    error: String? = null,
    onRetry: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Injections neutralisées (données, jamais exécutées).")
        when {
            isLoading -> Text("Chargement…")
            error != null -> {
                Text("Erreur réseau. Réessayer.")
                Button(onClick = onRetry) { Text("Réessayer") }
            }
            alerts.isEmpty() -> Text("Aucune alerte. Bon signe.")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(alerts, key = { it.id }) { alert ->
                    SecurityAlertCard(alert)
                }
            }
        }
    }
}

@Composable
fun SecurityAlertCard(alert: SecurityAlert) {
    Card {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            // Titre structuré seul ; excerpt ci-dessous = donnée brute.
            Text("Injection neutralisée · ${alert.source}")
            Text("Donnée suspecte (non exécutée) : ${SecurityAlert.sanitizeExcerpt(alert.excerpt)}")
        }
    }
}

// Route câblée serveur : loader injecté depuis app (ApiClient allowlist,
// SecurityAlertsRepository). UI reste découplée du réseau pour tests.
// ponytail: état local seul (pas de ViewModel avant offline #14).
@Composable
fun SecurityAlertsRoute(
    loadAlerts: suspend () -> List<SecurityAlert>,
) {
    var alerts by remember { mutableStateOf<List<SecurityAlert>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var nonce by remember { mutableStateOf(0) }
    LaunchedEffect(nonce) {
        loading = true
        error = null
        try {
            alerts = loadAlerts()
        } catch (_: Exception) {
            error = "network"
        } finally {
            loading = false
        }
    }
    SecurityAlertsScreen(
        alerts = alerts,
        isLoading = loading,
        error = error,
        onRetry = { nonce += 1 },
    )
}

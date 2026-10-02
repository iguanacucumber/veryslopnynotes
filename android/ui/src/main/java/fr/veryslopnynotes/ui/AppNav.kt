package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import fr.veryslopnynotes.core.SecurityAlert
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.FileCacheStore
import fr.veryslopnynotes.data.InMemoryCacheStore
import fr.veryslopnynotes.data.SyncedRepository

// Lecture hors-ligne #14 : cache local + affichage sans reseau.
// Offline-first : lecture synchrone du cache au demarrage (jamais de
// spinner si cache dispo), refresh reseau en echec = repli cache.
// Badge "perime" via CachePolicy (miroir contrats cache phase 5).
// Appairage QR+PIN #15 : route "pairing" (PairingRoute), token chiffré.
// Alertes sécurité #21 : route "alerts" (SecurityAlertsRoute, I6).
// Fiches révision #30 : route "fiches" (RevisionSheetsScreen).
// Contenu serveur affiche comme donnee, jamais interprete.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppNav(
    baseUrl: String = DEFAULT_BASE_URL,
    loadAlerts: suspend () -> List<SecurityAlert> = { emptyList() },
) {
    val nav = rememberNavController()
    val ctx = LocalContext.current.applicationContext
    // ponytail: fichier natif seul (pas de Room). Repli memoire si stockage KO.
    val repo = remember(baseUrl) {
        val store = try {
            FileCacheStore(java.io.File(ctx.filesDir, "offline"))
        } catch (_: Exception) {
            InMemoryCacheStore()
        }
        SyncedRepository(ApiClient(baseUrl), store)
    }
    Scaffold(
        topBar = { TopAppBar(title = { Text("VerySlopyNyNotes") }) },
    ) { pad ->
        NavHost(
            navController = nav,
            startDestination = "grades",
            modifier = Modifier.padding(pad),
        ) {
            composable("grades") {
                CachedScreen("Notes", CachePolicy.GRADES, repo, baseUrl, "assignments", { nav.navigate(it) }, { nav.navigate("pairing") }, { nav.navigate("alerts") })
            }
            composable("assignments") {
                CachedScreen("Devoirs", CachePolicy.ASSIGNMENTS, repo, baseUrl, "timetable", { nav.navigate(it) }, { nav.navigate("pairing") }, { nav.navigate("alerts") })
            }
            composable("timetable") {
                CachedScreen("EDT", CachePolicy.TIMETABLE, repo, baseUrl, "grades", { nav.navigate(it) }, { nav.navigate("pairing") }, { nav.navigate("alerts") })
            }
            composable("pairing") {
                if (baseUrl.isBlank()) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Appairage")
                        Text("Serveur non configuré.")
                        Button(onClick = { nav.popBackStack() }) { Text("Retour") }
                    }
                } else {
                    PairingRoute(baseUrl = baseUrl, onBack = { nav.popBackStack() })
                }
            }
            composable("alerts") { SecurityAlertsRoute(loadAlerts) }
            composable("fiches") { RevisionSheetsScreen() }
        }
    }
}

@Composable
fun CachedScreen(
    title: String,
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    next: String,
    go: (String) -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
) {
    // Etat initial = cache synchrone (affichage sans reseau immediat).
    var state by remember(resource) {
        val c = try {
            repo.cached(resource)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(if (c == null) UiState.Empty else uiStateFromCache(c, repo.isStale(resource, c)))
    }
    fun refresh() {
        state = when (val s = state) {
            // Re-affichage cache pendant reload (pas de spinner plein ecran si donnees).
            is UiState.Data -> s
            is UiState.Error -> if (s.cached != null) UiState.Data(s.cached, true, 0L) else UiState.Loading
            else -> UiState.Loading
        }
        try {
            repo.refreshAsync(resource, baseUrl) { o -> state = uiStateFromOutcome(o) }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
        }
    }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title)
        when (val s = state) {
            UiState.Loading -> Text("Chargement…")
            UiState.Empty -> Text("Aucune donnée en cache. Connectez-vous puis actualisez.")
            is UiState.Data -> {
                if (s.isStale) Text("Données hors-ligne (périmé).")
                // ponytail: payload brut affiche tel quel (donnee, jamais interpretee).
                Text(if (s.payload.length > 500) s.payload.take(500) + "…" else s.payload)
            }
            is UiState.Error -> {
                Text("Erreur réseau. Réessayer.")
                if (s.cached != null) Text(s.cached.take(500))
            }
        }
        Button(onClick = { refresh() }) { Text("Actualiser") }
        Button(onClick = { go(next) }) { Text("Aller à $next") }
        Button(onClick = { goPairing() }) { Text("Appairage QR+PIN") }
        Button(onClick = { goAlerts() }) { Text("Alertes sécurité") }
    }
}

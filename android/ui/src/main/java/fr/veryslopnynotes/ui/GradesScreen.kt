package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.SyncedRepository
import fr.veryslopnynotes.data.SubjectPrefs

// Écran « ressource en cache » : lecture synchrone du cache au démarrage (jamais
// de spinner si le cache est là), refresh réseau en échec = repli cache
// (offline-first #14). Servi par l'onglet Notes (`showAverage = true`, moyenne
// générale) et par l'écran Compétences (`section` = chips + détail, #78).
//
// #135 : ce composable (`CachedScreen`, renommé `CachedResourceScreen` parce
// que deux routes le partagent) SORT d'`AppNav.kt` (970 lignes qui portaient la
// coquille ET quatre écrans). Comportement inchangé, SAUF :
//   - le paramètre `title` et son `Text(title)` DISPARAISSENT : la barre du
//     haut affiche le titre de la route (« Notes », « Compétences »), donc
//     l'écran ne répète plus le nom de l'écran sous un titre identique ;
//   - le sous-titre, qui faisait fonction de titre de section, passe à
//     `MaterialTheme.typography.titleMedium` (échelle #134, premier adopter).
// REDESIGN : #139 pour l'onglet Notes (moyennes par matière, graphique, plus de
// JSON brut) et #144 pour la route Compétences (états vides, sans bouton de
// debug). Le `ponytail:` ci-dessous vaut pour l'ancien code, pas pour le
// nouveau.
@Composable
fun CachedResourceScreen(
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    subtitle: String,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
    // #74 : mention "fournie"/"estimée" sous le titre (onglet Notes seul).
    showAverage: Boolean = false,
    // #83 : prefs matière du résolveur unique (légende couleur/emoji/libellé).
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // #78 : bloc competencies (chips) rendu sous le titre, payload en entrée.
    section: (@Composable (String?) -> Unit)? = null,
    // #78 : accès à l'écran compétences depuis l'onglet Notes.
    onCompetences: (() -> Unit)? = null,
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
        // Serveur non configuré : pas d'appel (I1), état erreur avec cache si dispo.
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            return
        }
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
        Text(subtitle, style = MaterialTheme.typography.titleMedium)
        if (showAverage) {
            // Donnee contractuelle lue, jamais interpretee (I6). Absent = aucun affichage.
            val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
            Text(averageLabel(if (payload != null) generalAverageFrom(payload) else null))
        }
        when (val s = state) {
            UiState.Loading -> Text("Chargement…")
            UiState.Empty -> Text("Aucune donnée en cache. Connectez-vous puis actualisez.")
            is UiState.Data -> {
                if (s.isStale) Text("Données hors-ligne (périmé).")
                // #83 : matières du payload résolues (nom seul si aucune prefs).
                SubjectLegend(subjectsFromPayload(s.payload), subjectPrefs)

                section?.invoke(s.payload)
                // ponytail: payload brut affiche tel quel (donnee, jamais interpretee).
                Text(if (s.payload.length > 500) s.payload.take(500) + "…" else s.payload)
            }
            is UiState.Error -> {
                Text("Erreur réseau. Réessayer.")
                SubjectLegend(subjectsFromPayload(s.cached.orEmpty()), subjectPrefs)

                section?.invoke(s.cached)
                if (s.cached != null) Text(s.cached.take(500))
            }
        }
        Button(onClick = { refresh() }) { Text("Actualiser") }
        if (onCompetences != null) {
            Button(onClick = { onCompetences() }) { Text("Compétences") }
        }
        Button(onClick = { goSettings() }) { Text("Réglages") }
        Button(onClick = { goPairing() }) { Text("Appairage QR+PIN") }
        Button(onClick = { goAlerts() }) { Text("Alertes sécurité") }
    }
}
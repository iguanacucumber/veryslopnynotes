package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SyncedRepository

// Onglet Notes #139 : le JSON brut tronqué à 500 caractères a disparu — plus
// aucune chaîne de caractères du payload n'est rendue, nulle part dans ce
// fichier (le garde-fou est `android-averages.test.ts`). À la place, TOUT ce que
// le serveur envoie déjà est affiché : moyenne générale + provenance, sparkline
// d'historique, moyennes par matière, notes avec leur contexte de classe,
// influence de chaque note, sélecteur de période (premier vrai appel à
// `/v1/periods`) et sélecteur d'algorithme de moyenne.
//
// Le rendu est réparti en trois fichiers, un par responsibility :
//   - `GradesScreen.kt` (ici) : l'ÉTAT et le câblage (cache, réseau, periods) ;
//   - `GradesHero.kt` : carte héro + sparkline `Canvas` ;
//   - `GradesRows.kt` : sélecteurs, carrousel, sections par matière, lignes.
// La logique pure (parsing, mise en forme, géométrie) vit dans `Averages.kt`.
//
// `CachedResourceScreen` reste en bas de fichier pour la route Compétences
// (`section` + légende matières) : son rendu appartient à #144, mais le JSON
// brut qu'il vidait sous les données structurées était, lui, le défaut de #139.

/**
 * Onglet Notes, câblé sur le payload `/v1/grades` en cache.
 *
 * Cycle de vie : cache synchrone au premier rendu (jamais de spinner si le
 * cache est là), puis refresh réseau ; échec réseau = repli cache avec bandeau
 * « périmé ». Changer de période ou d'algorithme REJOUE la requête avec une
 * autre query (`gradesQuery`) : c'est le serveur qui recalcule les moyennes,
 * l'historique et les influences, l'app ne fait que changer ce qu'elle demande.
 *
 * @param resource ressource cachable visée (`CachePolicy.GRADES`), passée comme
 *   les autres onglets pour que la route reste la seule à nommer la politique.
 */
@Composable
fun GradesRoute(
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    onCompetences: (() -> Unit)? = null,
    goSettings: () -> Unit = {},
    goPairing: () -> Unit = {},
    goAlerts: () -> Unit = {},
) {
    // UNE horloge pour tout l'écran : les dates relatives (« il y a 4 jours »)
    // ne doivent pas changer d'une ligne à l'autre. Elle est relue à chaque
    // refresh, donc un écran laissé ouvert ne vieillit pas ses libellés.
    var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    var algorithm by remember { mutableStateOf(ALGORITHM_DEFAULT) }
    var periodId by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var algorithmOpen by remember { mutableStateOf(false) }
    var periods by remember { mutableStateOf(emptyList<PeriodUi>()) }
    var periodsError by remember { mutableStateOf<String?>(null) }
    var state by remember(resource) {
        val cached = try {
            repo.cached(resource)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(if (cached == null) UiState.Empty else uiStateFromCache(cached, repo.isStale(resource, cached)))
    }

    fun refresh() {
        // Serveur non configuré : aucun appel (I1), état erreur avec cache si dispo.
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            return
        }
        // Données déjà là = on les garde affichées pendant le reload (pas de
        // spinner plein écran sur un écran dense).
        state = when (val s = state) {
            is UiState.Data -> s
            is UiState.Error -> if (s.cached != null) UiState.Data(s.cached, true, 0L) else UiState.Loading
            else -> UiState.Loading
        }
        try {
            repo.refreshAsync(resource, baseUrl, gradesQuery(algorithm, periodId)) { o ->
                state = uiStateFromOutcome(o)
                nowMillis = System.currentTimeMillis()
            }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
        }
    }

    /**
     * Tranches de l'établissement : PREMIER appel à `/v1/periods` depuis l'app.
     * La liste est petite (trimestres/semestres de l'année), donc elle est lue à
     * chaque entrée sur l'écran plutôt que mise en cache : un cache de plus pour
     * une donnée qui change une fois par an ne vaut pas une ressource de plus
     * dans la politique shared (`CACHEABLE_RESOURCES`).
     */
    fun loadPeriods() {
        if (baseUrl.isBlank()) return
        try {
            repo.fetchPeriods(baseUrl) { o ->
                when (o) {
                    is RefreshOutcome.Updated -> {
                        periods = periodsFrom(o.payload)
                        periodsError = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        periods = periodsFrom(o.payload)
                        periodsError = null
                    }
                    is RefreshOutcome.Failed -> {
                        // Période choisie mais liste absente = on garde la note
                        // affichée et on ne pretend pas qu'il n'y a qu'un
                        // trimestre : le bandeau d'erreur le dit.
                        periodsError = o.message
                    }
                }
            }
        } catch (_: Exception) {
            periodsError = "Périodes indisponibles."
        }
    }

    // ponytail: un `LaunchedEffect` par CLÉ (période + algorithme) : changer de
    // période rejoue la requête, changer d'algorithme aussi, sans doublon au
    // premier rendu (comme la navigation de semaine de `TimetableRoute`).
    LaunchedEffect(resource, algorithm, periodId) { refresh() }
    LaunchedEffect(baseUrl) { loadPeriods() }

    val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
    val report = payload?.let { averagesFrom(it) }
    val grades = gradesForPeriod(gradesFrom(payload), periodId)
    val filtered = grades.filter { gradeMatches(it, query) }
    // Recherche active : une matière dont TOUTES les notes ont été filtrées ne
    // garde pas son en-tête (une section vide est du bruit, pas une info).
    val groups = gradeGroups(filtered, report?.subjects ?: emptyList())
        .filter { query.isEmpty() || it.grades.isNotEmpty() }
    val recent = recentGrades(filtered)

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        GradesSearchField(query = query, onQueryChange = { query = it })
        GradesPeriodChips(periods = periods, selectedId = periodId, onSelect = { periodId = it })
        val periodError = periodsError
        if (periodError != null) {
            Text(
                text = "Tranches indisponibles : $periodError",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        GradesPeriodCaption(periods = periods, selectedId = periodId)

        val data = state as? UiState.Data
        if (data != null && data.isStale) {
            PapStaleBanner(fetchedAt = data.fetchedAt, onRefresh = { refresh() })
        }
        when (val s = state) {
            UiState.Loading -> PapLoading()
            UiState.Empty -> PapEmptyState(
                icon = Icons.Filled.Star,
                title = "Aucune note en cache",
                description = "Actualisez pour lire les notes de l'établissement.",
            )
            is UiState.Error -> PapErrorState(
                message = s.message,
                onRetry = { refresh() },
                detail = if (s.cached == null) null else "Les notes en cache sont plus bas.",
            )
            is UiState.Data -> Unit
        }

        if (payload != null) {
            GradesAverageHero(
                report = report,
                onAlgorithmClick = { algorithmOpen = !algorithmOpen },
            )
            GradesHistoryNote(report)
        }
        // Papillon ouvre le choix du calcul depuis le chevron de la carte héro.
        // Sans données, il n'y a pas de carte : les chips restent alors visibles,
        // sinon le sélecteur serait inatteignable sur un écran vide.
        if (algorithmOpen || payload == null) {
            GradesAlgorithmChips(selected = algorithm, onSelect = { algorithm = it })
        }
        // Titre de section HORS du bloc « données » : il nomme ce que l'onglet
        // montre, donc il reste visible même sans note (état vide, hors-ligne
        // sans cache) au lieu d'un écran qui ne dit rien.
        PapSectionHeader(
            icon = Icons.Filled.Star,
            title = "Moyennes par matière",
            // `general.subjectCount` est le compteur du CONTRAT ; le nombre
            // de sections affichées sert de repli quand il est absent.
            count = report?.subjectCount?.takeIf { it > 0 } ?: groups.size,
        )
        if (payload != null && recent.isNotEmpty()) {
            Text("Nouvelles notes", style = MaterialTheme.typography.titleMedium)
            GradesRecentCarousel(grades = recent, prefs = subjectPrefs, nowMillis = nowMillis)
        }
        if (payload != null) {
            if (filtered.isEmpty()) {
                if (query.isNotEmpty()) {
                    PapEmptyState(
                        icon = Icons.Filled.Star,
                        title = "Aucune note trouvée",
                        description = "Aucune note ne correspond à « $query ».",
                    )
                } else {
                    PapEmptyState(
                        icon = Icons.Filled.Star,
                        title = "Aucune note sur cette période",
                        description = "L'établissement n'a publié aucune note ici.",
                    )
                }
            } else {
                GradesSubjectSections(
                    groups = groups,
                    prefs = subjectPrefs,
                    influences = report?.influences ?: emptyList(),
                    nowMillis = nowMillis,
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(onClick = { refresh() }) {
                Icon(imageVector = Icons.Filled.Refresh, contentDescription = null)
                Text("Actualiser")
            }
            if (onCompetences != null) {
                TextButton(onClick = { onCompetences() }) { Text("Compétences") }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(onClick = { goSettings() }) { Text("Réglages") }
            TextButton(onClick = { goPairing() }) { Text("Appairage QR+PIN") }
            TextButton(onClick = { goAlerts() }) { Text("Alertes sécurité") }
        }
    }
}

// Écran « ressource en cache » : lecture synchrone du cache au démarrage (jamais
// de spinner si le cache est là), refresh réseau en échec = repli cache
// (offline-first #14). Servi par la route Compétences (`section` = chips + détail,
// #78) ; son rendu complet appartient à #144.
//
// #135 : ce composable (`CachedScreen`, renommé `CachedResourceScreen` parce
// que deux routes le partagent) SORT d'`AppNav.kt` (989 lignes qui portaient la
// coquille ET quatre écrans).
//
// #139 : le rendu du JSON brut tronqué DISPARAÎT (c'était le défaut de cet
// onglet : une chaîne de caractères à la place de données, y compris dans la
// branche d'erreur). Un écran sans section structurée ne rend donc AUCUNE donnée
// brute : mieux vaut un vide franc qu'une chaîne illisible. L'onglet Notes a son
// propre rendu ([GradesRoute]) ; la route Compétences garde le sien via
// `section`. Le paramètre `showAverage` part avec lui : la moyenne est désormais
// dans la carte héro de `GradesHero.kt`, pas dans un `Text` générique.
@Composable
fun CachedResourceScreen(
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    subtitle: String,
    goSettings: () -> Unit,
    goPairing: () -> Unit,
    goAlerts: () -> Unit,
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
        when (val s = state) {
            UiState.Loading -> Text("Chargement…")
            UiState.Empty -> Text("Aucune donnée en cache. Connectez-vous puis actualisez.")
            is UiState.Data -> {
                if (s.isStale) Text("Données hors-ligne (périmé).")
                // #83 : matières du payload résolues (nom seul si aucune prefs).
                SubjectLegend(subjectsFromPayload(s.payload), subjectPrefs)

                section?.invoke(s.payload)
                if (section == null) {
                    Text(
                        "Pas de rendu détaillé pour cette ressource.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            is UiState.Error -> {
                Text("Erreur réseau. Réessayer.")
                SubjectLegend(subjectsFromPayload(s.cached.orEmpty()), subjectPrefs)

                section?.invoke(s.cached)
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
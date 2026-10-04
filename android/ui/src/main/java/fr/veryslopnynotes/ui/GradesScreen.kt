package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
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
// #162 — ce que la capture sur appareil a montré de cet écran, et ce que ce
// fichier corrige :
//   1. l'état vide/erreur était rendu AU MILIEU de la page, contrôles et liens
//      de navigation encore en dessous : un écran sans donnée est désormais un
//      état UNIQUE (message + une action), rien dessous — c'est la décision
//      pure `gradesLayout` (`Averages.kt`) qui départage, donc elle se teste ;
//   2. `Actualiser`, `Compétences`, `Réglages`, `Appairage QR+PIN` et
//      `Alertes sécurité` étaient des liens en clair dans le corps : ce sont des
//      destinations, ils sont montés dans la barre du haut (`TOP_BAR_ACTIONS`
//      d'`AppShell.kt`). D'où [refreshTick] : la barre n'a pas accès à l'état
//      local de l'écran, elle lui rend juste un compteur de relecture ;
//   3. `Tranches indisponibles : Hors-ligne, tranches indisponibles.` : le
//      message d'échec de `/v1/periods` PORTAIT DÉJÀ le nom de la ressource, le
//      préfixe de l'écran le répétait. Le message est désormais rendu tel quel ;
//   4. les puces d'algorithme et le titre « Moyennes par matière » sortaient
//      avec zéro donnée : ils n'existent plus que dans la branche qui a des
//      notes à montrer.
//
// Le rendu est réparti en trois fichiers, un par responsibility :
//   - `GradesScreen.kt` (ici) : l'ÉTAT et le câblage (cache, réseau, periods) ;
//   - `GradesHero.kt` : carte héro + sparkline `Canvas` ;
//   - `GradesRows.kt` : sélecteurs, carrousel, sections par matière, lignes.
// La logique pure (parsing, mise en forme, géométrie, décision d'affichage)
// vit dans `Averages.kt`.
//
// `CachedResourceScreen` reste en bas de fichier pour la route Compétences
// (`section` + légende matières) : son rendu appartient à #144, mais les liens
// de navigation qu'il portait en clair sont, eux, retirés avec ceux de l'onglet
// Notes (même écran en cache, mêmes destinations dans la barre du haut).

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
 * @param refreshTick compteur de relecture venu de la barre du haut (#162) :
 *   l'action « Actualiser » de la barre rejoue le même effet qu'un `LaunchedEffect`
 *   neuf, donc la requête part sans que l'écran ait à exposer son `refresh()`.
 */
@Composable
fun GradesRoute(
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    refreshTick: Int = 0,
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
            // Même vocabulaire que la couche data (« Hors-ligne, tranches
            // indisponibles. ») : l'utilisateur lit la même notion partout.
            periodsError = "Tranches indisponibles."
        }
    }

    // ponytail: un `LaunchedEffect` par CLÉ (période + algorithme + relecture) :
    // changer de période rejoue la requête, changer d'algorithme aussi, l'action
    // « Actualiser » de la barre du haut aussi (son compteur, #162), sans doublon
    // au premier rendu (comme la navigation de semaine de `TimetableRoute`).
    LaunchedEffect(resource, algorithm, periodId, refreshTick) { refresh() }
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
    // La décision « contenu, ou état unique » est PURE (`gradesLayout`), donc
    // elle se teste sans téléphone : c'est elle qui porte les critères de #162.
    val layout = gradesLayout(state, grades, report)

    if (!layout.content || !layout.data) {
        // Un écran SANS rien à montrer est UN état : un message, une action, et
        // RIEN en dessous. Pas de champ de recherche, pas de puces, pas de
        // titre de section : c'était l'état d'erreur au milieu de la page.
        GradesBlankState(state = state, query = query, onRefresh = { refresh() })
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        GradesSearchField(query = query, onQueryChange = { query = it })
        GradesPeriodChips(periods = periods, selectedId = periodId, onSelect = { periodId = it })
        val periodError = periodsError
        if (periodError != null) {
            // #162 : le message d'échec est rendu TEL QUEL. Le préfixe
            // (« Tranches indisponibles : … ») répétait ce que le message
            // disait déjà, d'où « Tranches indisponibles : Hors-ligne, tranches
            // indisponibles. » sur la capture.
            Text(
                text = periodError,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        GradesPeriodCaption(periods = periods, selectedId = periodId)

        val data = state as? UiState.Data
        if (data != null && data.isStale) {
            PapStaleBanner(fetchedAt = data.fetchedAt, onRefresh = { refresh() })
        }
        // Échec de la RELECTURE alors que le cache est là : les notes restent
        // affichées, la cause est dite en une ligne. Le gros bloc rouge avec son
        // « Réessayer » doublait l'action de la barre du haut.
        val failed = state as? UiState.Error
        if (failed != null) {
            Text(
                text = failed.message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }

        GradesAverageHero(
            report = report,
            onAlgorithmClick = { algorithmOpen = !algorithmOpen },
        )
        GradesHistoryNote(report)
        // Papillon ouvre le choix du calcul depuis le chevron de la carte héro,
        // donc les chips ne sortent que sur demande : sans données il n'y a pas
        // de carte, et des chips sous un vide étaient le défaut #162.
        if (algorithmOpen) {
            GradesAlgorithmChips(selected = algorithm, onSelect = { algorithm = it })
        }
        // Le titre de section ne précède QUE les sections qu'il nomme, donc il
        // sort avec elles ; une recherche sans résultat (ou une période sans
        // note, moyennes présentes) reçoit un message, pas un titre au-dessus
        // du vide.
        if (filtered.isEmpty()) {
            GradesNothingToShow(query = query, onRefresh = { refresh() })
        } else {
            if (recent.isNotEmpty()) {
                // `heading()` : « Nouvelles notes » precede le carrousel — c'est
                // un titre de section, même sans icône.
                Text(
                    text = "Nouvelles notes",
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                GradesRecentCarousel(grades = recent, prefs = subjectPrefs, nowMillis = nowMillis)
            }
            PapSectionHeader(
                icon = Icons.Filled.Star,
                title = "Moyennes par matière",
                // `general.subjectCount` est le compteur du CONTRAT ; le nombre
                // de sections affichées sert de repli quand il est absent.
                count = report?.subjectCount?.takeIf { it > 0 } ?: groups.size,
            )
            GradesSubjectSections(
                groups = groups,
                prefs = subjectPrefs,
                influences = report?.influences ?: emptyList(),
                nowMillis = nowMillis,
            )
        }
    }
}

/**
 * Un seul message là où l'écran a des MOYENNES mais aucune note à lister :
 * recherche sans résultat, ou période sans note.
 *
 * Le repli « Actualisez » n'a de sens que sans recherche (l'établissement peut
 * publier entre-temps) : une recherche qui ne trouve rien n'a rien à recharger.
 */
@Composable
private fun GradesNothingToShow(query: String, onRefresh: () -> Unit) {
    val refresh: @Composable () -> Unit = { Button(onClick = onRefresh) { Text("Actualiser") } }
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
            action = refresh,
        )
    }
}

/**
 * Écran SANS donnée : un état UNIQUE — squelette de chargement, cache vide,
 * échec, ou payload lu sans aucune note (avec ou sans recherche). Un message,
 * une action, aucun contrôle.
 *
 * Tout ce que la requête peut laisser tient ici, donc l'écran ne peut pas
 * afficher un état AU MILIEU d'une page de contrôles (#162) : il appelle cette
 * fonction et s'arrête.
 */
@Composable
private fun GradesBlankState(
    state: UiState,
    query: String,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Slot d'action = un LAMBDA COMPOSABLE, pas un `() -> Unit` : c'est ce que
    // le type de `PapEmptyState.action` attend.
    val refresh: @Composable () -> Unit = { Button(onClick = onRefresh) { Text("Actualiser") } }
    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (state) {
            UiState.Loading -> PapLoading()
            UiState.Empty -> PapEmptyState(
                icon = Icons.Filled.Star,
                title = "Aucune note en cache",
                description = "Actualisez pour lire les notes de l'établissement.",
                action = refresh,
            )
            is UiState.Error -> PapErrorState(message = state.message, onRetry = onRefresh)
            // Payload lu, mais zéro note ET zéro moyenne : pas de carte héro
            // « aucune moyenne » AU-DESSUS d'un « aucune note », ce sont deux
            // phrases pour dire la même chose.
            is UiState.Data -> GradesNothingToShow(query = query, onRefresh = onRefresh)
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
//
// #162 : les quatre boutons de navigation (`Actualiser`, `Réglages`,
// `Appairage QR+PIN`, `Alertes sécurité`) sortent du CORPS — ils sont montés
// dans la barre du haut (`TOP_BAR_ACTIONS` d'`AppShell.kt`, entrées Notes ET
// Compétences : c'est le même écran en cache). D'où [refreshTick] : la barre
// déclenche la relecture par un compteur, pas en appelant un `refresh()` local.
// Conséquence assumée : cet écran se relit à l'ENTRÉE (comme les autres
// onglets) au lieu d'attendre un clic.
@Composable
fun CachedResourceScreen(
    resource: String,
    repo: SyncedRepository,
    baseUrl: String,
    subtitle: String,
    // #83 : prefs matière du résolveur unique (légende couleur/emoji/libellé).
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    // #78 : bloc competencies (chips) rendu sous le titre, payload en entrée.
    section: (@Composable (String?) -> Unit)? = null,
    refreshTick: Int = 0,
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
    // Cache affiché d'abord, relecture ensuite (offline-first #14) ; le compteur
    // de la barre du haut rejoue le même effet (#162).
    LaunchedEffect(resource, refreshTick) { refresh() }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // `heading()` : le sous-titre est le titre de cet écran sous la barre.
        Text(
            text = subtitle,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { heading() },
        )
        when (val s = state) {
            UiState.Loading -> Text("Chargement…", maxLines = 1)
            UiState.Empty -> Text("Aucune donnée en cache. Connectez-vous puis actualisez.", maxLines = 3)
            is UiState.Data -> {
                if (s.isStale) Text("Données hors-ligne (périmé).", maxLines = 1)
                // #83 : matières du payload résolues (nom seul si aucune prefs).
                SubjectLegend(subjectsFromPayload(s.payload), subjectPrefs)

                section?.invoke(s.payload)
                if (section == null) {
                    Text(
                        "Pas de rendu détaillé pour cette ressource.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            is UiState.Error -> {
                // Le VRAI message du serveur + le geste qui recommence : le
                // texte « Erreur réseau. Réessayer. » promettait un bouton qui
                // est parti dans la barre (#162), donc il ne reste que le
                // message. Le rendu complet de cet écran appartient à #144.
                PapErrorState(message = s.message, onRetry = { refresh() })
                SubjectLegend(subjectsFromPayload(s.cached.orEmpty()), subjectPrefs)

                section?.invoke(s.cached)
            }
        }
    }
}
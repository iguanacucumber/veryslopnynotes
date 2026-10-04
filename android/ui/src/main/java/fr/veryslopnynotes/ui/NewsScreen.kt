package fr.veryslopnynotes.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.NewsItem
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.NewsRepository
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SyncedRepository
import java.time.ZoneId

// Écran Actualités #79 : liste des actes de l'établissement (parité Papillon).
//
// Contenu serveur = DONNÉE affichée par `Text` seul : pas de WebView, pas de
// Html.fromHtml, pas de lien cliquable, pas d'exécution (I6).
// Vide propre « Aucune actualité » (onglet inactif = 200 + liste vide), jamais
// de spinner infini : état = cache synchrone puis repli cache hors-ligne.
//
// #144 — les défauts trouvés sur cet écran :
//   - `NewsItem.read` s'affichait par le TEXTE « Lu » / « Non lu » : aucune
//     couleur, aucune pastille, et surtout AUCUN geste pour marquer lu ;
//   - `category` et `author` étaient concaténés sur la ligne du titre, avec la
//     date ISO brute (« 2026-10-02 ») : trois informations illisibles en un
//     seul bout de texte ;
//   - aucun PullToRefresh, alors que l'accueil en a un (`HomePullToRefresh`).
//
// L'écran regroupe donc par `category`, pose une PASTILLE sur ce qui n'est pas
// lu, et dit l'auteur et la date en temps RELATIF (« il y a 4 min ») : la
// fonction est celle de `PapComponents.kt`, [relativeTimeFr], donc testable.
//
// ponytail: le contrat n'expose AUCUNE écriture de lecture (#79, add-only) :
//   l'état « lu » posé par l'utilisateur est donc portée par l'ÉCRAN, pour la
//   session — le libellé du bouton le dit, rien n'est maquillé en synchronisé.
//   Upgrade: route d'écriture + invalidation CacheInvalidated, comme la
//   messagerie (#80).

/** Catégorie de repli quand l'établissement ne publie pas de catégorie. */
const val NEWS_CATEGORY_OTHER = "Autres actualités"

/** Un groupe d'actualités : un en-tête de catégorie + ses items. */
data class NewsGroupUi(val category: String, val items: List<NewsItem>)

/** Lignes du corps d'une carte : au-delà, la carte tronque avec une ellipse. */
private const val NEWS_BODY_MAX_LINES = 4

/** Côte de la pastille « non lu ». */
private val UNREAD_DOT = 8.dp

// Payload cache illisible/absent = liste vide propre (jamais d'exception UI).
fun newsFromPayload(payload: String?): List<NewsItem> = try {
    if (payload == null) emptyList() else NewsRepository.parse(payload)
} catch (_: Exception) {
    emptyList()
}

/** En-tête de groupe : la catégorie publiée, ou le repli si elle est absente. */
fun newsCategoryLabel(category: String): String = category.trim().ifEmpty { NEWS_CATEGORY_OTHER }

/**
 * Regroupement par catégorie : catégories ordonnées par leur actualité la plus
 * récente, items du plus récent au plus ancien.
 *
 * `linkedMapOf` conserve l'ordre d'insertion, donc deux payloads identiques
 * produisent exactement le même écran (pas de saut entre deux recompositions).
 * Le tri est STABLE côté source (on compare `publishedAt` puis l'identifiant) :
 * deux actualités de même date ne s'échangent pas d'une ligne à l'autre.
 */
fun newsGroups(news: List<NewsItem>): List<NewsGroupUi> {
    val buckets = linkedMapOf<String, MutableList<NewsItem>>()
    for (item in news) {
        buckets.getOrPut(newsCategoryLabel(item.category)) { ArrayList() }.add(item)
    }
    return buckets.entries
        .map { (category, items) ->
            NewsGroupUi(
                category = category,
                items = items.sortedWith(
                    compareByDescending<NewsItem> { it.publishedAt }.thenBy { it.id },
                ),
            )
        }
        .sortedByDescending { group -> group.items.firstOrNull()?.publishedAt ?: "" }
}

/**
 * Ligne auteur + date, en temps relatif.
 *
 * `now` et `zone` sont INJECTÉS : « il y a 4 min » dépend de l'horloge ET du
 * fuseau, donc la fonction serait sinon impossible à tester (même choix que
 * [relativeTimeFr]). Date illisible = pas de ligne du tout, plutôt qu'une date
 * devinée.
 */
fun newsByline(item: NewsItem, now: Long, zone: ZoneId): String {
    // Lecteur ISO déjà écrit et testé pour l'accueil (`homeMillisOf`) : `Z`,
    // décalage explicite et date seule. Réécrire le parsing ici aurait été un
    // troisième exemplaire du même.
    val epoch = homeMillisOf(item.publishedAt) ?: return ""
    val date = relativeTimeFr(epoch, now, zone)
    val author = item.author.trim()
    return if (author.isEmpty()) date else "Par $author · $date"
}

@Composable
fun NewsScreen(
    news: List<NewsItem>,
    isLoading: Boolean = false,
    isStale: Boolean = false,
    fetchedAt: Long? = null,
    error: String? = null,
    onRetry: () -> Unit = {},
    onMarkRead: (NewsItem) -> Unit = {},
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
) {
    // La colonne paddée englobe TOUS les états : sans elle, le squelette de
    // chargement était collé au bord de l'écran (les briques Papillon paddent
    // elles-mêmes, le corps d'écran non).
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when {
            isLoading && news.isEmpty() -> {
                PapLoading()
                return@Column
            }
            // Le VRAI message d'échec, pas la chaîne figée.
            error != null && news.isEmpty() -> {
                PapErrorState(message = error, onRetry = onRetry)
                return@Column
            }
            news.isEmpty() -> {
                PapEmptyState(
                    icon = Icons.Filled.Notifications,
                    title = "Aucune actualité.",
                    description = "L'établissement n'a publié aucun acte pour le moment.",
                    action = { Button(onClick = onRetry) { Text("Actualiser") } },
                )
                return@Column
            }
        }
        if (isStale) PapStaleBanner(fetchedAt = fetchedAt, onRefresh = onRetry)
        // Relecture échouée alors que la liste est là : la cause passe en une
        // ligne, jamais en gros bloc rouge au milieu des cartes.
        if (error != null) {
            Text(
                text = error,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val groups = newsGroups(news)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (group in groups) {
                item(key = "cat-${group.category}") {
                    PapSectionHeader(
                        icon = Icons.Filled.Notifications,
                        title = group.category,
                        count = group.items.size,
                    )
                }
                for (item in group.items) {
                    item(key = item.id) {
                        NewsCard(item, onMarkRead, now, zone)
                    }
                }
            }
        }
    }
}

/**
 * Carte d'une actualité : PASTILLE non lu, titre en gras, auteur + date
 * relatifs, corps borné à [NEWS_BODY_MAX_LINES] lignes et l'action « marquer
 * lu ».
 *
 * Le corps est borné en LIGNES, pas en un bouton « Lire la suite » qui n'aurait
 * nulle part où mener : sans écran de détail, un bouton de plus serait un bouton
 * mort. Le texte entier reste dans le payload, donc rien n'est perdu.
 */
@Composable
fun NewsCard(
    item: NewsItem,
    onMarkRead: (NewsItem) -> Unit,
    now: Long,
    zone: ZoneId,
    modifier: Modifier = Modifier,
) {
    PapCard(modifier = modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!item.read) {
                    // La pastille est DÉCORATIVE pour l'œil mais ANNONCÉE : c'est
                    // elle qui porte « non lu » pour un lecteur d'écran (le
                    // libellé texte « Non lu » avait été retiré).
                    Box(
                        modifier = Modifier
                            .size(UNREAD_DOT)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary)
                            .semantics { contentDescription = "Actualité non lue" },
                    )
                }
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
            }
            val byline = newsByline(item, now, zone)
            if (byline.isNotEmpty()) {
                Text(
                    text = byline,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // Donnée brute ci-dessous : texte de l'établissement, jamais une
            // instruction (I6).
            if (item.body.isNotBlank()) {
                Text(
                    text = item.body,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = NEWS_BODY_MAX_LINES,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!item.read) {
                TextButton(onClick = { onMarkRead(item) }) { Text("Marquer comme lu") }
            }
        }
    }
}

/**
 * Route actualités : cache synchrone au démarrage, relecture réseau, repli
 * cache hors-ligne, et PullToRefresh (le même composant que l'accueil — zéro
 * dépendance ajoutée).
 *
 * #144 : l'état « lu » posé par l'utilisateur est un ensemble d'identifiants
 * **de session** (`readIds`) appliqué au payload à chaque recomposition. Le
 * contrat n'ayant pas d'écriture de lecture, c'est la seule chose honnête à
 * afficher — et c'est ce que dit le libellé du bouton.
 */
@Composable
fun NewsRoute(
    repo: SyncedRepository,
    baseUrl: String,
) {
    var news by remember {
        mutableStateOf(
            try {
                newsFromPayload(repo.cached(CachePolicy.NEWS)?.payload)
            } catch (_: Exception) {
                emptyList()
            },
        )
    }
    var loading by remember { mutableStateOf(false) }
    var stale by remember { mutableStateOf(false) }
    var fetchedAt by remember { mutableStateOf<Long?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    // Lus de la session : l'app n'écrit pas l'état de lecture (#79 add-only).
    // #147 : sauvegardés malgré tout — sans eux, la pastille « non lu » revenait
    // sur tout ce que l'utilisateur venait de marquer lu, sans qu'il l'ait
    // redemandé. Ce sont des IDENTIFIANTS, aucun texte de l'établissement.
    var readIds by rememberSaveable { mutableStateOf(emptySet<String>()) }
    fun refresh() {
        if (baseUrl.isBlank()) {
            error = "Serveur non configuré."
            return
        }
        loading = true
        try {
            repo.refreshAsync(CachePolicy.NEWS, baseUrl) { o ->
                when (o) {
                    is RefreshOutcome.Updated -> {
                        news = newsFromPayload(o.payload)
                        fetchedAt = o.fetchedAt
                        stale = false
                        error = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        news = newsFromPayload(o.payload)
                        fetchedAt = o.fetchedAt
                        stale = o.stale
                        error = null
                    }
                    is RefreshOutcome.Failed -> {
                        news = newsFromPayload(o.cachedPayload)
                        error = o.message
                    }
                }
                loading = false
            }
        } catch (_: Exception) {
            error = "Erreur inattendue."
            loading = false
        }
    }
    // Cache affiché d'abord, relecture ensuite (offline-first #14). Le
    // rechargement se déclenche au PullToRefresh de l'écran : cette route n'a pas
    // d'action « Actualiser » dans la barre (cf. `TOP_BAR_ACTIONS`), donc pas de
    // compteur à câbler ici.
    LaunchedEffect(Unit) { refresh() }

    // Un item déjà lu côté établissement le reste ; « lu » posé par l'utilisateur
    // s'ajoute par-dessus (jamais l'inverse : on ne dé-marque pas).
    val shown = news.map { item -> if (item.id in readIds) item.copy(read = true) else item }

    HomePullToRefresh(refreshing = loading, onRefresh = { refresh() }) {
        NewsScreen(
            news = shown,
            isLoading = loading,
            isStale = stale,
            fetchedAt = fetchedAt,
            error = error,
            onRetry = { refresh() },
            onMarkRead = { item -> readIds = readIds + item.id },
        )
    }
}
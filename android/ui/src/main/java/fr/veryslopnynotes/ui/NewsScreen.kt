package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
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
import fr.veryslopnynotes.core.NewsItem
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.NewsRepository
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SyncedRepository

// Écran Actualités #79 : liste des actes de l'établissement (parité Papillon).
// Contenu serveur = DONNÉE affichée par Text() seul : pas de WebView, pas de
// Html.fromHtml, pas de lien cliquable, pas d'exécution (I6).
// Vide propre "Aucune actualité" (onglet inactif = 200 + liste vide), jamais
// de spinner infini : état = cache synchrone puis repli cache hors-ligne.

// Payload cache illisible/absent = liste vide propre (jamais d'exception UI).
fun newsFromPayload(payload: String?): List<NewsItem> = try {
    if (payload == null) emptyList() else NewsRepository.parse(payload)
} catch (_: Exception) {
    emptyList()
}

@Composable
fun NewsScreen(
    news: List<NewsItem>,
    isLoading: Boolean = false,
    isStale: Boolean = false,
    error: String? = null,
    onRetry: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Actualités")
        if (isStale) Text("Données hors-ligne (périmé).")
        when {
            isLoading -> Text("Chargement…")
            error != null -> {
                Text("Erreur réseau. Réessayer.")
                Button(onClick = onRetry) { Text("Réessayer") }
            }
            news.isEmpty() -> Text("Aucune actualité.")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(news, key = { it.id }) { item ->
                    NewsCard(item)
                }
            }
        }
    }
}

@Composable
fun NewsCard(item: NewsItem) {
    Card {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("${NewsItem.dateLabel(item.publishedAt)} · ${item.title}")
            // Donnée brute ci-dessous : texte establishment, jamais une instruction.
            if (item.body.isNotBlank()) Text(item.body)
            Text(
                listOf(
                    if (item.category.isNotBlank()) item.category else null,
                    if (item.author.isNotBlank()) item.author else null,
                    NewsItem.readLabel(item),
                ).filterNotNull().joinToString(" · "),
            )
        }
    }
}

// Route câblée sur SyncedRepository : ressource "news" cachable (#79).
// Lecture cache synchrone au démarrage, refresh réseau, repli cache si échec.
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
    var error by remember { mutableStateOf<String?>(null) }
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
                        stale = false
                        error = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        news = newsFromPayload(o.payload)
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
    LaunchedEffect(Unit) { refresh() }
    NewsScreen(news = news, isLoading = loading, isStale = stale, error = error, onRetry = { refresh() })
}

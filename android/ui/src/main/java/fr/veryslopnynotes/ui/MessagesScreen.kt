package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Discussion
import fr.veryslopnynotes.core.DiscussionMessage
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.DiscussionRules
import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DiscussionsRepository
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SyncedRepository

// Onglet Messagerie #80 (parité Papillon Discussions) : liste des fils, lecture
// d'un fil, réponse, création, lu/non-lu, suppression.
//
// I6 : sujet et corps de message = DONNÉES de l'ENT affichées par Text() seul
// (aucun WebView, aucun HTML, aucune exécution). I1 : pièces jointes via le
// PROXY serveur /v1/media (URL construite par ServerConfig), jamais une adresse
// Pronote/ENT. I7 : chaque écriture part d'un TAP utilisateur (bouton), jamais
// d'un traitement automatique ; le cache est purgé via l'événement
// CacheInvalidated renvoyé par le serveur.

// Liste des fils depuis le cache : payload absent ou illisible = liste vide propre.
fun discussionsFromPayload(payload: String?): List<Discussion> = try {
    if (payload == null) emptyList() else DiscussionsRepository.parse(payload)
} catch (_: Exception) {
    emptyList()
}

// Dernier message d'un fil (dérivé des messages reçus, jamais du cache).
fun lastMessageOf(messages: List<DiscussionMessage>): DiscussionMessage? = messages.lastOrNull()

@Composable
fun MessagesScreen(
    discussions: List<Discussion>,
    isLoading: Boolean = false,
    isStale: Boolean = false,
    error: String? = null,
    onRetry: () -> Unit = {},
    onOpen: (Discussion) -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Messages")
        Text("Discussions")
        if (isStale) Text("Données hors-ligne (périmé).")
        when {
            isLoading && discussions.isEmpty() -> Text("Chargement…")
            error != null && discussions.isEmpty() -> {
                Text("Erreur réseau. Réessayer.")
                Button(onClick = onRetry) { Text("Réessayer") }
            }
            // Onglet Discussions inactif côté établissement = liste vide (200).
            discussions.isEmpty() -> Text("Aucune discussion.")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(discussions, key = { it.id }) { d ->
                    DiscussionCard(d, onOpen)
                }
            }
        }
        Button(onClick = onRetry) { Text("Actualiser") }
    }
}

@Composable
private fun DiscussionCard(d: Discussion, onOpen: (Discussion) -> Unit) {
    Card {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            // Sujet = donnée d'affichage seule.
            Text(d.subject)
            val who = DiscussionRules.participantLabel(d.participants)
            if (who.isNotEmpty()) Text(who)
            val date = DiscussionRules.dateLabel(
                if (d.lastMessageAt.isNotEmpty()) d.lastMessageAt else d.updatedAt,
            )
            if (date.isNotEmpty()) Text(date)
            val unread = DiscussionRules.unreadLabel(d.unreadCount)
            if (unread.isNotEmpty()) Text(unread)
            Button(onClick = { onOpen(d) }) { Text("Ouvrir") }
        }
    }
}

// Lecture d'un fil + réponse. Écritures = boutons (geste utilisateur, I7).
// ponytail: champ de réponse en TextField simple (pas de Piece jointe à l'envoi :
// le serveur n'expose pas d'envoi de fichier, `listeFichiers` est vide côté lib).
@Composable
fun DiscussionDetailScreen(
    discussion: Discussion,
    messages: List<DiscussionMessage>,
    baseUrl: String,
    isLoading: Boolean = false,
    notice: String? = null,
    onReply: (String) -> Unit = {},
    onReadState: (Boolean) -> Unit = {},
    onDelete: () -> Unit = {},
    onBack: () -> Unit = {},
) {
    var draft by remember(discussion.id) { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(discussion.subject)
        val who = DiscussionRules.participantLabel(discussion.participants)
        if (who.isNotEmpty()) Text(who)
        if (notice != null) Text(notice)
        if (isLoading) {
            Text("Chargement…")
        } else if (messages.isEmpty()) {
            Text("Aucun message.")
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(messages, key = { it.id }) { m ->
                    MessageCard(m, baseUrl, accountId)
                }
            }
        }
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            label = { Text("Répondre") },
        )
        // I7 : l'envoi ne part que de ce bouton (action confirmée par l'app).
        Button(
            onClick = { onReply(draft) },
            enabled = draft.isNotBlank(),
        ) { Text("Envoyer") }
        Button(onClick = { onReadState(true) }) { Text("Marquer lu") }
        Button(onClick = { onReadState(false) }) { Text("Marquer non lu") }
        Button(onClick = onDelete) { Text("Supprimer la discussion") }
        Button(onClick = onBack) { Text("Retour") }
    }
}

@Composable
private fun MessageCard(m: DiscussionMessage, baseUrl: String, accountId: String) {
    Card {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            val date = DiscussionRules.dateLabel(m.sentAt)
            if (date.isNotEmpty()) Text(date)
            // Auteur absent = message du compte appairé : aucun nom deviné.
            if (m.authorName.isNotBlank()) Text(m.authorName)
            // Corps = donnée brute de l'ENT (élève ou enseignant), jamais exécutée.
            Text(m.body)
            for (att in m.attachments) {
                // Téléchargement via le PROXY serveur : l'URL n'est jamais celle
                // de l'ENT (I1). URL affichée telle quelle, pas d'Intent tant que
                // le téléchargement n'a pas été demandé.
                Text("Pièce jointe : ${att.label} — ${ServerConfig.mediaUrl(baseUrl, accountId, att.ref)}")
            }
        }
    }
}

// Nouvelle discussion : sujet + corps + destinataires. Écriture = bouton (I7).
@Composable
fun NewDiscussionScreen(
    recipients: List<DiscussionRecipient>,
    isLoading: Boolean = false,
    notice: String? = null,
    onCreate: (String, String, List<String>) -> Unit = { _, _, _ -> },
    onBack: () -> Unit = {},
) {
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf(listOf<String>()) }
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Nouvelle discussion")
        if (notice != null) Text(notice)
        OutlinedTextField(
            value = subject,
            onValueChange = { subject = it },
            label = { Text("Objet") },
            singleLine = true,
        )
        OutlinedTextField(
            value = body,
            onValueChange = { body = it },
            label = { Text("Message") },
        )
        if (isLoading) {
            Text("Chargement…")
        } else if (recipients.isEmpty()) {
            Text("Aucun destinataire publié par l'établissement.")
        } else {
            for (r in recipients) {
                val on = r.id in picked
                Button(onClick = {
                    picked = if (on) picked.filter { it != r.id } else picked + r.id
                }) {
                    Text("${if (on) "✓ " else ""}${r.displayName} (${r.kind})")
                }
            }
        }
        Button(
            onClick = { onCreate(subject, body, picked) },
            enabled = subject.isNotBlank() && body.isNotBlank() && picked.isNotEmpty(),
        ) { Text("Envoyer") }
        Button(onClick = onBack) { Text("Retour") }
    }
}

// Route câblée : liste depuis le cache `discussions` (offline-first), puis
// refresh réseau ; ouverture d'un fil = lecture serveur de ses messages (jamais
// en cache, donnée personnelle) ; chaque écriture est confirmée par un bouton
// puis relance un refresh de la liste (le serveur renvoie l'invalidation).
@Composable
fun MessagesRoute(
    repo: SyncedRepository,
    baseUrl: String,
    accountId: String,
) {
    val api = remember(baseUrl) { ApiClient(baseUrl) }
    val discussionsRepo = remember(api) { DiscussionsRepository(api) }
    // Cache synchrone au démarrage (affichage hors-ligne sans attendre le réseau).
    var payload by remember {
        mutableStateOf(
            try {
                discussionsFromPayload(repo.cached(CachePolicy.DISCUSSIONS)?.payload)
            } catch (_: Exception) {
                emptyList()
            },
        )
    }
    var loading by remember { mutableStateOf(false) }
    var stale by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Discussion?>(null) }
    var messages by remember { mutableStateOf<List<DiscussionMessage>>(emptyList()) }
    var messagesLoading by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var recipients by remember { mutableStateOf<List<DiscussionRecipient>>(emptyList()) }

    fun refresh() {
        // Serveur non configuré : aucun appel (I1), état erreur avec cache si dispo.
        if (baseUrl.isBlank()) {
            error = "Serveur non configuré."
            return
        }
        loading = true
        try {
            repo.refreshAsync(CachePolicy.DISCUSSIONS, baseUrl) { o ->
                when (o) {
                    is RefreshOutcome.Updated -> {
                        payload = discussionsFromPayload(o.payload)
                        stale = false
                        error = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        payload = discussionsFromPayload(o.payload)
                        stale = o.stale
                        error = null
                    }
                    is RefreshOutcome.Failed -> {
                        payload = discussionsFromPayload(o.cachedPayload)
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

    // Ouvre un fil : messages lus sur le serveur (jamais de cache disque).
    fun openDiscussion(d: Discussion) {
        open = d
        messages = emptyList()
        messagesLoading = true
        discussionsRepo.fetchMessages(d.id) { list, err ->
            messages = list
            messagesLoading = false
            if (err != null) notice = err
        }
    }

    fun back() {
        open = null
        messages = emptyList()
        notice = null
    }

    fun loadRecipients() {
        creating = true
        recipients = emptyList()
        discussionsRepo.fetchRecipients { list, err ->
            recipients = list
            creating = false
            if (err != null) notice = err
        }
    }

    LaunchedEffect(Unit) { refresh() }

    val current = open
    if (creating) {
        NewDiscussionScreen(
            recipients = recipients,
            isLoading = false,
            notice = notice,
            onCreate = { subject, body, ids ->
                // I7 : geste utilisateur confirmé, rien d'automatique.
                discussionsRepo.create(baseUrl, subject, body, ids) { outcome ->
                    notice = outcome.error
                    if (outcome.ok) {
                        creating = false
                        refresh()
                    }
                }
            },
            onBack = { creating = false; notice = null },
        )
    } else if (current != null) {
        DiscussionDetailScreen(
            discussion = current,
            messages = messages,
            baseUrl = baseUrl,
            isLoading = messagesLoading,
            notice = notice,
            onReply = { body ->
                discussionsRepo.reply(baseUrl, current.id, body) { outcome ->
                    notice = outcome.error
                    if (outcome.ok) {
                        messages = emptyList()
                        discussionsRepo.fetchMessages(current.id) { list, err ->
                            messages = list
                            messagesLoading = false
                            if (err != null) notice = err
                        }
                        refresh()
                    }
                }
            },
            onReadState = { read ->
                discussionsRepo.setRead(baseUrl, current.id, read) { outcome ->
                    notice = outcome.error
                    if (outcome.ok) refresh()
                }
            },
            onDelete = {
                discussionsRepo.delete(baseUrl, current.id) { outcome ->
                    notice = outcome.error
                    if (outcome.ok) {
                        back()
                        refresh()
                    }
                }
            },
            onBack = { back() },
        )
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MessagesScreen(
                discussions = payload,
                isLoading = loading,
                isStale = stale,
                error = error,
                onRetry = { refresh() },
                onOpen = { openDiscussion(it) },
            )
            Button(onClick = { loadRecipients() }) { Text("Nouvelle discussion") }
        }
    }
}
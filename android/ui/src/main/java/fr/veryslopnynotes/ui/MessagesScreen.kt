package fr.veryslopnynotes.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.Discussion
import fr.veryslopnynotes.core.DiscussionMessage
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.DiscussionRules
import fr.veryslopnynotes.core.MessageAttachment
import fr.veryslopnynotes.data.ApiClient
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.DiscussionsRepository
import fr.veryslopnynotes.data.DiscussionWriteOutcome
import fr.veryslopnynotes.data.RefreshOutcome
import fr.veryslopnynotes.data.SyncedRepository
import fr.veryslopnynotes.data.TokenStore
import java.time.ZoneId

// MESSAGERIE #142 — liste de fils, fil, nouvelle discussion.
//
// #142 a trouvé quatre défauts de FORME (le CONTENU, lui, était déjà sage) :
//   - « Supprimer la discussion » en UN BOUTON pleine largeur, sans dialogue : un
//     appui perdu effaçait un fil entier. Le fil porte maintenant `ConfirmDialog`
//     (destructif, encre `error`) derrière son menu ;
//   - `unreadCount` rendu par la chaîne « 3 non lu(s) » en texte plat : la
//     PASTILLE `PapBadge` le rend d'un coup d'œil et elle est CLiquable (marquer
//     lu), le fil gardant le choix lu / non-lu dans son menu ;
//   - les destinataires : une pile de boutons pleine largeur préfixés « ✓ »,
//     devenus des PUCES groupées par type et étiquetées en français
//     (professeur / élève / administration). Le contrat garde `teacher`,
//     l'interface ne l'affiche JAMAIS (critère d'acceptation de #142) ;
//   - la zone de réponse sous un `LazyColumn` NON PONDÉRÉ, avec six boutons
//     pleine largeur dessous : la liste porte `weight(1f)`, et l'envoi est une
//     icône au bout du champ, pas une barre verte.
//
// PAS DE RÉFÉRENCE CAPTURÉE : l'onglet Messagerie de Papillon n'est pas dans les
// quatre onglets échantillonnés (accueil / cours / tâches / notes), donc l'écran
// est dessiné dans le MÊME langage que le reste : cartes blanches à filet, rayon
// 20, pastille d'accent, encre secondaire à 65 %, titres en gras, pastilles de
// compteur.
//
// I6 : sujet, participants, corps de message et libellé de pièce jointe sont des
// DONNÉES de l'établissement affichées par `Text()` seul — aucun WebView, aucun
// HTML, aucune exécution, aucun rendu de lien actif. I7 : chaque écriture part d'un
// GESTE (carte, puce, menu, icône), jamais d'un traitement automatique. I1 : aucune
// adresse d'établissement n'est construite ni affichée ici.
// ponytail: pas de `Scaffold` par écran (la coquille porte la barre et le titre
// de la route) ; le snackbar, lui, est UNIQUE et RACINE (`Motion.kt`), donc cet
// écran ne le dessine pas.
//
// #145 — les trois bandeaux `Text` de la version d'avant (écriture refusée,
// message de la liste, message du fil ouvert) sont partis dans le snackbar, avec
// une couleur de sévérité et une fermeture automatique. Ils ne se distinguaient
// pas : une réussite et un refus s'affichaient pareil.
//
// ET L'ANNULATION D'UNE SUPPRESSION N'EST PAS CÂBLÉE, DÉLIBÉRÉMENT. Le contrat
// n'expose que `POST /v1/discussions/delete` : aucune route de restauration, ni
// côté serveur ni dans l'app. Un « Annuler » qui rendrait une ligne locale ferait
// promises que le rafraîchissement suivant tiendrait : la fil disparaît au premier
// `GET /v1/discussions`. Le paramètre [DiscussionDetailScreen.onUndoDelete] reste
// donc nul — c'est le point de branchement quand le contrat portera un
// `POST /v1/discussions/restore`. En attendant, une suppression réussie est
// annoncée SANS action, et une suppression refusée propose « Réessayer », qui
// existe.

/** Épaisseur du filet des bulles et des puces (1 dp, comme les cartes de #134). */
private val HAIRLINE = 1.dp

// Liste des fils depuis le cache : payload absent ou illisible = liste vide propre.
fun discussionsFromPayload(payload: String?): List<Discussion> = try {
    if (payload == null) emptyList() else DiscussionsRepository.parse(payload)
} catch (_: Exception) {
    emptyList()
}

// --- Liste des conversations -------------------------------------------------

/**
 * Liste des fils : recherche, pastille de non-lus, tri par dernier message, puis
 * une carte par fil (initiale, sujet, aperçu ou participants, temps relatif).
 *
 * [previews] = aperçu du dernier message PAR FIL, connu seulement après avoir
 * ouvert le fil : `/v1/discussions` ne publie que l'horodatage (`lastMessageAt`),
 * pas le corps — donc la liste n'invente aucun texte à froid, elle affiche les
 * participants.
 */
@Composable
fun MessagesScreen(
    discussions: List<Discussion>,
    nowMillis: Long,
    zone: ZoneId,
    isLoading: Boolean = false,
    isStale: Boolean = false,
    fetchedAt: Long? = null,
    error: String? = null,
    previews: Map<String, String> = emptyMap(),
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
    onOpen: (Discussion) -> Unit = {},
    onToggleRead: (Discussion) -> Unit = {},
    onNew: () -> Unit = {},
) {
    var query by remember { mutableStateOf("") }
    val visible = searchConversations(discussions, query)
    val unread = unreadTotal(discussions)
    // #145 : l'état affiché comme VALEUR — le `Crossfade` compare des valeurs, pas
    // des branches de `when`. Les quatre cas restent ceux d'avant ; ce qui change,
    // c'est que l'on passe de l'un à l'autre en fondu au lieu de faire disparaître
    // la liste puis la remettre d'un frame à l'autre.
    val stateKey = when {
        isLoading && discussions.isEmpty() -> "loading"
        error != null && discussions.isEmpty() -> "error"
        visible.isEmpty() -> "empty"
        else -> "list"
    }
    HomePullToRefresh(refreshing = isLoading && visible.isNotEmpty(), onRefresh = onRefresh) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            // Pas de titre ici : la barre du haut porte « Messages » (#135). Cette
            // rangée compte les fils et offre l'action « Nouvelle discussion ».
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (unread > 0) PapPill(text = unreadTotalLabel(unread), color = MaterialTheme.colorScheme.primary)
                Text(
                    text = conversationCountLabel(visible.size),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onNew) {
                    Icon(imageVector = Icons.Filled.Create, contentDescription = null, modifier = Modifier.size(18.dp))
                    Text(text = "Nouvelle", modifier = Modifier.padding(start = 4.dp))
                }
            }
            SearchField(query = query, onQueryChange = { query = it }, label = "Rechercher une discussion")
            // #145 : le bandeau « périmé » s'ouvre au lieu d'apparaître d'un coup.
            // Les messages d'écriture et d'échec de lecture ne passent PLUS par un
            // `Text` ici : ils sortent par le snackbar racine, qui a une couleur de
            // sévérité et une fermeture automatique.
            PapAppear(visible = isStale) {
                PapStaleBanner(fetchedAt = fetchedAt, onRefresh = onRefresh)
            }
            // `weight(1f)` : AVANT #142, le `LazyColumn` n'était PAS pondéré et les
            // boutons qui le suivaient devenaient hors d'atteinte dès que la
            // liste débordait. Ici la zone liste occupe toute la hauteur restante
            // et les états possibles la remplissent au lieu de flotter en haut.
            Box(modifier = Modifier.weight(1f)) {
                Crossfade(targetState = stateKey, label = "messagesState") { _ -> when {
                    isLoading && discussions.isEmpty() -> PapLoading()
                    error != null && discussions.isEmpty() -> PapErrorState(message = error, onRetry = onRetry)
                    visible.isEmpty() -> PapEmptyState(
                        icon = Icons.Filled.MailOutline,
                        title = if (query.isBlank()) "Aucune discussion." else "Aucune discussion ne correspond.",
                        description = if (query.isBlank()) {
                            "L'établissement n'a publié aucune discussion."
                        } else {
                            "Aucun sujet ni participant ne porte ces mots."
                        },
                        action = { TextButton(onClick = onRefresh) { Text("Actualiser") } },
                    )
                    else -> LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
                    ) {
                        items(visible, key = { it.id }) { d ->
                            ConversationCard(
                                d = d,
                                preview = previews[d.id].orEmpty(),
                                nowMillis = nowMillis,
                                zone = zone,
                                onOpen = { onOpen(d) },
                                onToggleRead = { onToggleRead(d) },
                            )
                        }
                    }
                }
            }
            }
        }
    }
}

/**
 * Carte d'un fil : pastille d'initiale, sujet en gras, sous-titre (aperçu du
 * dernier message connu, sinon participants), et à droite le temps relatif puis la
 * PASTILLE de non-lus.
 *
 * La pastille est cliquable (marquer lu) et occupe sa propre zone : un tap dedans
 * n'ouvre pas le fil.
 */
@Composable
private fun ConversationCard(
    d: Discussion,
    preview: String,
    nowMillis: Long,
    zone: ZoneId,
    onOpen: () -> Unit,
    onToggleRead: () -> Unit,
) {
    val badge = unreadBadgeCount(d)
    val who = DiscussionRules.participantLabel(d.participants)
    val subtitle = preview.ifBlank { who }
    PapCard(modifier = Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Initiale du SUJET : un fil n'a pas de photo, donc la pastille porte
            // une lettre (repli « ? » de `subjectInitial`, #138) plutôt qu'un
            // disque vide.
            PapSubjectAvatar(emoji = subjectInitial(d.subject), color = MaterialTheme.colorScheme.primary)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = d.subject,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle.isNotEmpty()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                val time = conversationTimeLabel(d, nowMillis, zone)
                if (time.isNotEmpty()) {
                    Text(
                        text = time,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
                if (badge > 0) {
                    // Étiquette annoncée : sans elle, un lecteur d'écran ne dit pas
                    // ce que fait ce tap.
                    Box(
                        modifier = Modifier
                            .clip(MaterialTheme.shapes.small)
                            .clickable(onClickLabel = "Marquer lu", onClick = onToggleRead)
                            .padding(horizontal = 6.dp, vertical = 4.dp),
                    ) {
                        PapBadge(count = badge)
                    }
                }
            }
        }
    }
}

// --- Fil ouvert --------------------------------------------------------------

/**
 * Un fil : en-tête (retour, sujet, menu lu / non-lu / supprimer), bulles, zone de
 * réponse FIXE EN BAS.
 *
 * [draft] est détenu par la route : le brouillon ne s'efface que lorsque le
 * serveur a confirmé la réponse — un texte perdu sur un refus est un texte à
 * réécrire.
 *
 * [onUndoDelete] reste le point de branchement d'un « Annuler » HonestE : rien ne
 * le câble, et c'est DÉLIBÉRÉ. Le contrat n'expose que `POST /v1/discussions/delete`
 * — aucune route de restauration n'existe, donc un « Annuler » ne ferait que
 * reculer l'écran et la fil reviendrait, puis disparaîtrait au `GET` suivant : une
 * promesse que l'application ne peut pas tenir. Ce que l'app sait faire, c'est
 * RÉESSAYER la suppression refusée, et c'est ce qu'elle propose.
 */
@Composable
fun DiscussionDetailScreen(
    discussion: Discussion,
    messages: List<DiscussionMessage>,
    draft: String,
    nowMillis: Long,
    zone: ZoneId,
    isLoading: Boolean = false,
    isSending: Boolean = false,
    onDraftChange: (String) -> Unit = {},
    onReply: (String) -> Unit = {},
    onReadState: (Boolean) -> Unit = {},
    onDelete: () -> Unit = {},
    onBack: () -> Unit = {},
    onOpenAttachment: (MessageAttachment) -> Unit = {},
    onUndoDelete: (() -> Unit)? = null,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    // Un fil long s'ouvre sur sa fin, comme dans toute messagerie.
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.scrollToItem(messages.size - 1)
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(imageVector = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = discussion.subject,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val who = DiscussionRules.participantLabel(discussion.participants)
                if (who.isNotEmpty()) {
                    Text(
                        text = who,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Box {
                // AVANT #142 : deux boutons pleine largeur « Marquer lu » et
                // « Marquer non lu », empilés sous le fil. Les trois actions d'un
                // fil tiennent dans un menu, au pouce droit.
                IconButton(onClick = { menuOpen = true }) {
                    Icon(imageVector = Icons.Filled.MoreVert, contentDescription = "Actions de la discussion")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Marquer lu") },
                        onClick = {
                            menuOpen = false
                            onReadState(true)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Marquer non lu") },
                        onClick = {
                            menuOpen = false
                            onReadState(false)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Supprimer la discussion", color = MaterialTheme.colorScheme.error) },
                        onClick = {
                            menuOpen = false
                            confirmDelete = true
                        },
                    )
                }
            }
        }
        Box(modifier = Modifier.weight(1f)) {
            // #145 : chargement -> messages en fondu (cf. la liste).
            Crossfade(targetState = if (isLoading) "loading" else "messages", label = "threadState") { _ -> when {
                isLoading -> PapLoading()
                messages.isEmpty() -> PapEmptyState(
                    icon = Icons.Filled.MailOutline,
                    title = "Aucun message.",
                    description = "Ce fil est vide.",
                )
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    items(messages, key = { it.id }) { m ->
                        MessageBubble(
                            m = m,
                            nowMillis = nowMillis,
                            zone = zone,
                            onOpenAttachment = onOpenAttachment,
                        )
                    }
                }
            }
            }
        }
        ReplyField(
            draft = draft,
            isSending = isSending,
            onDraftChange = onDraftChange,
            onReply = onReply,
        )
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = "Supprimer la discussion",
            text = "« ${discussion.subject} » sera supprimée. Cette action est définitive.",
            confirmLabel = "Supprimer",
            destructive = true,
            onConfirm = {
                confirmDelete = false
                onDelete()
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

/**
 * Bulle d'un message : les messages DU COMPTE APPAIRÉ à droite, dans le
 * `primaryContainer` du thème ; les autres à gauche, sur la surface. L'auteur n'est
 * affiché que s'il est publié (champ omis = message de l'app, aucun nom deviné),
 * et le corps est une DONNÉE affichée telle quelle (I6).
 */
@Composable
private fun MessageBubble(
    m: DiscussionMessage,
    nowMillis: Long,
    zone: ZoneId,
    onOpenAttachment: (MessageAttachment) -> Unit,
) {
    val own = isOwnMessage(m)
    val time = messageTimeLabel(m, nowMillis, zone)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (own) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(0.85f),
            shape = MaterialTheme.shapes.medium,
            color = if (own) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
            border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outline),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalAlignment = if (own) Alignment.End else Alignment.Start,
            ) {
                if (!m.authorName.isBlank()) {
                    Text(
                        text = m.authorName,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Text(text = m.body, style = MaterialTheme.typography.bodyMedium)
                if (m.attachments.isNotEmpty()) {
                    AttachmentChips(attachments = m.attachments, onOpen = onOpenAttachment)
                }
                if (time.isNotEmpty()) {
                    Text(
                        text = time,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

/**
 * Pièces jointes en PUCES.
 *
 * AVANT #142, chaque pièce s'affichait par son URL de proxy en TEXTE PLAT —
 * illisible à l'œil, et une URL finit dans les logs : plus rien ne l'affiche.
 *
 * Le tap appelle [onOpen]. La seule réponse HONNÊTE aujourd'hui : `/v1/media`
 * exige le jeton du device, qu'aucune application tierce ne peut porter (401), et
 * le lui refuser reviendrait à DONNER un credential à un tiers ; les octets
 * ouverts DANS l'app demandent un `FileProvider` (module app) + une lecture par
 * l'app, comme la photo #82. Tant que ce n'est pas là, la puce dit pourquoi au
 * lieu de déclencher un 401 devant l'utilisateur.
 * ponytail: upgrade = `FileProvider` + `api.buildGet(mediaPath)` puis rendu in-app
 * (image, puis `PdfRenderer`). Aucune seconde copie du client média.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttachmentChips(attachments: List<MessageAttachment>, onOpen: (MessageAttachment) -> Unit) {
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (att in attachments) {
            Surface(
                modifier = Modifier.clickable { onOpen(att) },
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.surfaceVariant,
                border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outline),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Edit,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                    )
                    // Libellé de l'établissement = DONNÉE, bornée par le contrat.
                    Text(
                        text = att.label,
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/**
 * Zone de réponse FIXE EN BAS : champ pondéré + icône d'envoi, retour haptique au
 * tap (le geste est parti, l'utilisateur n'attend pas) — [rememberPapHaptics]
 * garde ce vocabulaire unique avec le reste de l'application.
 *
 * Le bouton n'occupe plus toute la largeur — AVANT #142, un `Button` vert sous un
 * champ, eux deux pleine largeur : la barre verte d'un envoi passerait pour
 * l'action principale de l'écran.
 */
@Composable
private fun ReplyField(
    draft: String,
    isSending: Boolean,
    onDraftChange: (String) -> Unit,
    onReply: (String) -> Unit,
) {
    val haptics = rememberPapHaptics()
    val canSend = draft.isNotBlank() && !isSending
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            label = { Text("Répondre") },
            maxLines = 4,
            modifier = Modifier.weight(1f),
        )
        IconButton(
            onClick = {
                haptics.confirm()
                onReply(draft)
            },
            enabled = canSend,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Send,
                contentDescription = if (isSending) "Envoi en cours" else "Envoyer",
                tint = if (canSend) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// --- Nouvelle discussion -----------------------------------------------------

/**
 * Nouvelle discussion : objet, message, RECHERCHE sur les destinataires, puis des
 * PUCES groupées par type sous des libellés FRANÇAIS.
 *
 * Le `kind` du contrat (`teacher`, `student`, `administration`) ne sort jamais de
 * `MessagesLogic.kt` : `recipientKindFr` le traduit, et un type hors contrat tombe
 * sous « Destinataire » au lieu d'être affiché brut.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NewDiscussionScreen(
    recipients: List<DiscussionRecipient>,
    isLoading: Boolean = false,
    onCreate: (String, String, List<String>) -> Unit = { _, _, _ -> },
    onBack: () -> Unit = {},
) {
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf(listOf<String>()) }
    val groups = searchRecipients(recipients, query)
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(imageVector = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
            }
            Text(
                text = "Nouvelle discussion",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
        }
        OutlinedTextField(
            value = subject,
            onValueChange = { subject = it },
            label = { Text("Objet") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        OutlinedTextField(
            value = body,
            onValueChange = { body = it },
            label = { Text("Message") },
            minLines = 3,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        )
        SearchField(
            query = query,
            onQueryChange = { query = it },
            label = "Rechercher un destinataire",
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        Box(modifier = Modifier.weight(1f)) {
            Crossfade(
                targetState = when {
                    isLoading -> "loading"
                    recipients.isEmpty() -> "none"
                    groups.isEmpty() -> "empty"
                    else -> "list"
                },
                label = "newDiscussionState",
            ) { _ -> when {
                isLoading -> PapLoading()
                recipients.isEmpty() -> PapEmptyState(
                    icon = Icons.Filled.MailOutline,
                    title = "Aucun destinataire publié par l'établissement.",
                    description = "La messagerie est active, mais l'établissement ne publie personne.",
                )
                groups.isEmpty() -> PapEmptyState(
                    icon = Icons.Filled.MailOutline,
                    title = "Aucun destinataire ne correspond.",
                    description = "Aucun nom ne porte ces mots.",
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    for (group in groups) {
                        item(key = "groupe-${group.kind}") {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                // En-tête de groupe : le libellé TRADUIT, jamais `kind`.
                                Text(
                                    text = "${group.label} · ${group.recipients.size}",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    for (r in group.recipients) {
                                        val on = r.id in picked
                                        FilterChip(
                                            selected = on,
                                            onClick = {
                                                picked = if (on) picked.filter { it != r.id } else picked + r.id
                                            },
                                            label = {
                                                Text(
                                                    text = r.displayName,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                    // 100 caractères de nom tiennent
                                                    // dans la borne du contrat, pas
                                                    // dans la largeur d'un écran : la
                                                    // puce est donc bornée.
                                                    modifier = Modifier.widthIn(max = 220.dp),
                                                )
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = pickedCountLabel(picked.size),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = { onCreate(subject, body, picked) },
                enabled = subject.isNotBlank() && body.isNotBlank() && picked.isNotEmpty(),
            ) { Text("Envoyer") }
        }
    }
}

// --- Briques d'écran ---------------------------------------------------------

/** Champ de recherche : loupe à gauche, croix à droite seulement s'il y a du texte. */
@Composable
private fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        label = { Text(label) },
        leadingIcon = { Icon(imageVector = Icons.Filled.Search, contentDescription = null) },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(imageVector = Icons.Filled.Clear, contentDescription = "Effacer la recherche")
                }
            }
        } else {
            null
        },
        singleLine = true,
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
    )
}

// #145 : il n'y a PLUS de rangée de message dans cet écran. Les trois usages
// qu'elle portait (échec d'écriture, message de la liste, message du fil) sont
// partis dans le snackbar racine, seul endroit qui sait teinter une sévérité et se
// refermer seul. Une rangée `Text` en encre d'erreur ne pouvait ni se distinguer
// d'une réussite, ni s'effacer.

// --- Route câblée ------------------------------------------------------------

// Route câblée : liste depuis le cache `discussions` (offline-first), puis refresh
// réseau ; ouverture d'un fil = lecture serveur de ses messages (jamais en cache,
// donnée personnelle) ; chaque écriture part d'un geste, puis relance un refresh de
// la liste (le serveur renvoie l'invalidation).
@Composable
fun MessagesRoute(
    repo: SyncedRepository,
    baseUrl: String,
    // `accountId` reste un paramètre de la route (`AppNav.kt` le passe) mais n'est
    // plus utilisé : AVANT #142, il servait à CONSTRUIRE l'URL du proxy /v1/media,
    // affichée en clair dans chaque bulle. Aucune URL n'est plus construite ici (le
    // proxy exige le jeton du device), donc le compte n'a plus rien à afficher.
    @Suppress("UNUSED_PARAMETER")
    accountId: String,
    // Bearer du device appairé (contrat 0.4.0), relu à chaque requête.
    tokens: TokenStore? = null,
) {
    val api = remember(baseUrl, tokens) { ApiClient(baseUrl, tokens = tokens) }
    val discussionsRepo = remember(api) { DiscussionsRepository(api) }
    val zone = remember { ZoneId.systemDefault() }
    // Cache synchrone au démarrage (affichage hors-ligne sans attendre le réseau) :
    // UNE seule lecture du fichier, les deux champs en sortent — et elle est
    // protégée, une lecture disque qui échoue ne doit pas tomber l'écran.
    val cachedAtStart = remember {
        try {
            repo.cached(CachePolicy.DISCUSSIONS)
        } catch (_: Exception) {
            null
        }
    }
    var payload by remember { mutableStateOf(discussionsFromPayload(cachedAtStart?.payload)) }
    var fetchedAt by remember { mutableStateOf(cachedAtStart?.fetchedAt) }
    var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    var loading by remember { mutableStateOf(false) }
    var stale by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // #145 : le poste de notices racine. Il REMPLACE l'état `notice` : plus de
    // texte à l'écran à effacer, plus de courses entre l'écriture et sa peinture —
    // une seule porte, qui colourise par sévérité et se referme seule.
    val notices = LocalPapNotice.current
    var open by remember { mutableStateOf<Discussion?>(null) }
    var messages by remember { mutableStateOf<List<DiscussionMessage>>(emptyList()) }
    var messagesLoading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var recipientsLoading by remember { mutableStateOf(false) }
    var recipients by remember { mutableStateOf<List<DiscussionRecipient>>(emptyList()) }
    // Aperçu du dernier message par fil, APRÈS ouverture : `/v1/discussions` ne
    // publie que l'horodatage, donc la liste n'invente aucun texte.
    var previews by remember { mutableStateOf<Map<String, String>>(emptyMap()) }

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
                        fetchedAt = o.fetchedAt
                        stale = false
                        error = null
                    }
                    is RefreshOutcome.OfflineFallback -> {
                        payload = discussionsFromPayload(o.payload)
                        fetchedAt = o.fetchedAt
                        stale = o.stale
                        error = null
                    }
                    is RefreshOutcome.Failed -> {
                        payload = discussionsFromPayload(o.cachedPayload)
                        error = o.message
                        // #145 : échec AVEC cache = la liste reste affichée, donc pas
                        // d'état d'écran ; le message du serveur sort donc en notice
                        // ROUGE. Sans cache, c'est `PapErrorState` qui le montre.
                        if (o.cachedPayload != null) {
                            notices.show(PapNotice(errorHeadline(o.message), NoticeKind.ERROR))
                        }
                    }
                }
                nowMillis = System.currentTimeMillis()
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
        draft = ""
        // Un message d'écriture de la LISTE ne suit pas l'utilisateur dans le fil
        // qu'il vient d'ouvrir.
        notices.dismiss()
        discussionsRepo.fetchMessages(d.id) { list, err ->
            messages = list
            messagesLoading = false
            if (err != null) notices.show(PapNotice(errorHeadline(err), NoticeKind.ERROR))
            val last = list.lastOrNull()
            if (last != null) previews = previews + (d.id to messagePreview(last.body))
        }
    }

    fun back() {
        open = null
        messages = emptyList()
        notices.dismiss()
        draft = ""
    }

    fun loadRecipients() {
        creating = true
        notices.dismiss()
        recipientsLoading = true
        recipients = emptyList()
        discussionsRepo.fetchRecipients { list, err ->
            recipients = list
            recipientsLoading = false
            if (err != null) notices.show(PapNotice(errorHeadline(err), NoticeKind.ERROR))
        }
    }

    /**
     * Sortie d'écriture : une RÉUSSITE en encre normale, un REFUS en rouge — et
     * un refus propose « Réessayer », parce que réessayer est une action que le
     * serveur sait effectuer. Aucune n'offre d'annulation : le contrat n'a pas de
     * route d'annulation, et un « Annuler » qui ne ferait que recharger l'écran
     * serait faux.
     */
    fun writeOutcome(outcome: DiscussionWriteOutcome, success: String, retry: () -> Unit) {
        val message = outcome.error
        if (outcome.ok) {
            if (success.isNotEmpty()) notices.show(PapNotice(success, NoticeKind.SUCCESS))
        } else if (!message.isNullOrBlank()) {
            notices.show(PapNotice(errorHeadline(message), NoticeKind.ERROR, "Réessayer", retry))
        }
    }

    LaunchedEffect(Unit) { refresh() }

    val current = open
    // Le fil et la nouvelle discussion sont des MODES de la route, pas des routes :
    // sans ces deux gardes, le geste système quittait l'onglet Messages au lieu de
    // revenir à la liste — l'en-tête proposait un retour que le système ignorait.
    BackHandler(enabled = creating) { creating = false; notices.dismiss() }
    BackHandler(enabled = !creating && current != null) { back() }
    if (creating) {
        NewDiscussionScreen(
            recipients = recipients,
            isLoading = recipientsLoading,
            onCreate = { subject, body, ids ->
                // I7 : geste utilisateur confirmé, rien d'automatique.
                discussionsRepo.create(baseUrl, subject, body, ids) { outcome ->
                    writeOutcome(outcome, "Discussion envoyée.") {
                        discussionsRepo.create(baseUrl, subject, body, ids) { again ->
                            writeOutcome(again, "Discussion envoyée.") {}
                        }
                    }
                    if (outcome.ok) {
                        creating = false
                        refresh()
                    }
                }
            },
            onBack = { creating = false; notices.dismiss() },
        )
    } else if (current != null) {
        DiscussionDetailScreen(
            discussion = current,
            messages = messages,
            draft = draft,
            nowMillis = nowMillis,
            zone = zone,
            isLoading = messagesLoading,
            isSending = sending,
            onDraftChange = { draft = it },
            onReply = { body ->
                sending = true
                // Fonction nommée, pas une lambda : c'est elle que « Réessayer »
                // rappelle, donc le refus se réessaie avec le MÊME texte — le
                // brouillon n'est vidé que sur accusé de réception.
                fun send() {
                    discussionsRepo.reply(baseUrl, current.id, body) { outcome ->
                        sending = false
                        writeOutcome(outcome, "Message envoyé.") { send() }
                        if (outcome.ok) {
                            draft = ""
                            messages = emptyList()
                            discussionsRepo.fetchMessages(current.id) { list, err ->
                                messages = list
                                messagesLoading = false
                                if (err != null) notices.show(PapNotice(errorHeadline(err), NoticeKind.ERROR))
                                val last = list.lastOrNull()
                                if (last != null) previews = previews + (current.id to messagePreview(last.body))
                            }
                            refresh()
                        }
                    }
                }
                send()
            },
            onReadState = { read ->
                discussionsRepo.setRead(baseUrl, current.id, read) { outcome ->
                    writeOutcome(outcome, "") {
                        discussionsRepo.setRead(baseUrl, current.id, read) { again ->
                            writeOutcome(again, "") {}
                        }
                    }
                    if (outcome.ok) refresh()
                }
            },
            // #142 : la suppression passe par `ConfirmDialog`, ouvert depuis le
            // menu du fil — plus jamais un bouton unique.
            onDelete = {
                val subject = current.subject
                fun del() {
                    discussionsRepo.delete(baseUrl, current.id) { outcome ->
                        // PAS de « Annuler » : le contrat n'expose que
                        // `POST /v1/discussions/delete`, sans route de restauration —
                        // un annuler local disparaîtrait au rafraîchissement suivant.
                        // « Réessayer », lui, existe (cf. l'en-tête du fichier).
                        writeOutcome(outcome, "« $subject » supprimée.") { del() }
                        if (outcome.ok) {
                            back()
                            refresh()
                        }
                    }
                }
                del()
            },
            onBack = { back() },
            // `/v1/media` exige le bearer du device : aucune application tierce ne
            // peut le porter, et lui en donner un serait l'exposer (401). La puce
            // explique donc la limite au lieu d'ouvrir une page d'échec — voir
            // `AttachmentChips`.
            onOpenAttachment = { att ->
                notices.show(
                    PapNotice(
                        "« ${att.label} » : l'ouverture dans l'application arrive bientôt. Le serveur exige la session de l'app, qu'aucune autre application ne peut porter.",
                        NoticeKind.INFO,
                    ),
                )
            },
        )
    } else {
        MessagesScreen(
            discussions = payload,
            nowMillis = nowMillis,
            zone = zone,
            isLoading = loading,
            isStale = stale,
            fetchedAt = fetchedAt,
            error = error,
            previews = previews,
            onRefresh = { refresh() },
            onRetry = { refresh() },
            onOpen = { openDiscussion(it) },
            // La pastille est l'action : marquer lu / non lu sans passer par le fil.
            onToggleRead = { d ->
                discussionsRepo.setRead(baseUrl, d.id, !conversationIsRead(d)) { outcome ->
                    writeOutcome(outcome, "") {
                        discussionsRepo.setRead(baseUrl, d.id, !conversationIsRead(d)) { again ->
                            writeOutcome(again, "") {}
                        }
                    }
                    if (outcome.ok) refresh()
                }
            },
            onNew = { loadRecipients() },
        )
    }
}
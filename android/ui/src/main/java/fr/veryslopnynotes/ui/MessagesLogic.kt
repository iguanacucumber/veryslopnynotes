package fr.veryslopnynotes.ui

import fr.veryslopnynotes.core.Discussion
import fr.veryslopnynotes.core.DiscussionMessage
import fr.veryslopnynotes.core.DiscussionRecipient
import fr.veryslopnynotes.core.enumFr
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

// LOGIQUE AFFICHABLE DE LA MESSAGERIE #142 : triage, recherche, libellés.
// Pure — aucun `@Composable`, aucun état, aucun réseau — donc son miroir TS la
// teste SANS téléphone (`tests/unit/android-discussions.test.ts`), ce que
// `make check` peut en effet faire.
//
// CE QUI ÉTAIT FAIT (#142) :
//   - aucun TRI : la liste suivait l'ordre du serveur, et la date était une
//     TRANCHE ISO (« 2026-10-03 ») tirée par `DiscussionRules.dateLabel` ;
//   - le compteur de non-lus existait mais en TEXTE PLAT (« 3 non lu(s) »)
//     produit par `DiscussionRules.unreadLabel` ;
//   - `DiscussionRecipient.kind` était imprimé BRUT (« teacher », « student »)
//     au milieu d'une phrase française ;
//   - aucune recherche : ni sur les fils, ni sur les destinataires.
//
// RÉUTILISÉ, JAMAIS RÉÉCRIT (le recheck du sujet est un défaut de #139/#136) :
// `relativeTimeFr` pour le temps relatif, `foldForSearch` pour le repli des
// accents, `subjectInitial` pour la pastille d'un sujet, `DiscussionRules`
// (core) pour les participants et les bornes.

/** Caractères d'un aperçu : deux lignes de corps court à l'écran, pas plus. */
private const val PREVIEW_MAX_CHARS = 120

/** Plafond de l'aperçu. `Discussion.MAX_BODY` (4 000) borne déjà le corps. */
private const val PREVIEW_MAX_BOUND = 4000

/**
 * Ordre d'AFFICHAGE des types de destinataire : professeur, élève,
 * administration — l'ordre du contrat (`student`, `teacher`,
 * `administration`) n'a pas de sens pour un utilisateur qui ne voit que des
 * mots français.
 *
 * #147 : les jetons restent listés ici parce que cet ordre est un choix
 * D'AFFICHAGE, mais les LIBELLÉS français viennent de `core/EnumFr.kt` (table
 * unique du contrat) : cette copie-ci a disparu.
 */
private val RECIPIENT_KIND_ORDER = listOf("teacher", "student", "administration")

/** Repli d'un type hors contrat : jamais le mot du contrat affiché tel quel. */
private const val RECIPIENT_KIND_FALLBACK = "Destinataire"

/**
 * Libellé de la pastille d'en-tête : « 1 non lu », « 3 non lus ».
 *
 * Jamais « 3 non lu(s) » : c'était la chaîne de `DiscussionRules.unreadLabel`,
 * que #142 remplace partout dans l'interface. Le compte de FILS non lus, pas la
 * somme des messages : « 3 non lus » dit à l'utilisateur qu'il a trois chose à
 * ouvrir, ce que la pastille de chaque carte détaille ensuite.
 */
fun unreadTotalLabel(filCount: Int): String =
    if (filCount > 1) "$filCount non lus" else "1 non lu"

/** Nombre de fils affichés : « 3 discussions » / « 1 discussion ». */
fun conversationCountLabel(count: Int): String =
    if (count > 1) "$count discussions" else "$count discussion"

/** Nombre de destinataires choisis : « 2 destinataires » / « 1 destinataire ». */
fun pickedCountLabel(count: Int): String =
    if (count > 1) "$count destinataires" else "$count destinataire"

/** Un groupe de destinataires SOUS son libellé français (prof / élève / administration). */
data class RecipientGroup(
    val kind: String,
    val label: String,
    val recipients: List<DiscussionRecipient>,
)

/**
 * Libellé français d'un type de destinataire.
 *
 * `isValid()` (core) refuse déjà un `kind` hors contrat, donc le repli est une
 * défense, pas une branche chaude : afficher « teacher » au milieu d'une phrase
 * française serait une faute de langue, pas un détail de style.
 */
fun recipientKindFr(kind: String): String = enumFr(kind, RECIPIENT_KIND_FALLBACK)

/**
 * Millis d'un horodatage ISO du contrat, ou null s'il est illisible.
 *
 * Les DEUX formes sont acceptées : l'instant complet (`Instant.parse`) et la
 * date seule (`LocalDate.parse`) — `Instant.parse` refuse « 2026-10-05 » alors
 * que le contrat (`Date.parse` côté TS) l'accepte, donc un fil daté sans heure ne
 * doit pas disparaître du triage. Une date SEULE est ramenée à minuit UTC : c'est
 * un ordre de grandeur, pas un horaire, et le libellé affiché dira « il y a N
 * jours » de toute façon.
 */
fun discussionMillis(iso: String): Long? {
    val value = iso.trim()
    if (value.isEmpty()) return null
    val instant = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    if (instant != null) return instant
    return runCatching {
        LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    }.getOrNull()
}

/** Instant du fil pour le TRI : `lastMessageAt`, sinon `updatedAt`, sinon null. */
fun conversationMillis(d: Discussion): Long? =
    discussionMillis(d.lastMessageAt) ?: discussionMillis(d.updatedAt)

/**
 * Fils triés du PLUS RÉCENT au plus ancien, sur l'INSTANT PARSÉ — pas sur la
 * chaîne : « 2026-10-9T… » et « 2026-10-10T… » se rangent dans l'autre ordre
 * avec un tri alphabétique.
 *
 * Trois règles, chacune payée : un fil sans date exploitable passe DERNIER (on ne
 * le place pas en tête sous un `updatedAt` vide), l'égalité est tranchée par
 * `id` (la liste ne doit pas se réordonner d'un rafraîchissement à l'autre), et
 * la liste d'origine n'est jamais modifiée (`sortedWith` renvoie une copie).
 */
fun sortConversations(list: List<Discussion>): List<Discussion> =
    list.sortedWith(
        compareByDescending<Discussion> { conversationMillis(it) ?: Long.MIN_VALUE }
            .thenBy { it.id },
    )

/** Le fil correspond-il à la recherche ? Sujet + participants, texte PLIÉ. */
fun conversationMatches(d: Discussion, query: String): Boolean {
    val needle = foldForSearch(query)
    if (needle.isEmpty()) return true
    return (listOf(d.subject) + d.participants).any { foldForSearch(it).contains(needle) }
}

/** Fils filtrés par la recherche, puis triés : la liste affichée en est une. */
fun searchConversations(list: List<Discussion>, query: String): List<Discussion> =
    sortConversations(list.filter { conversationMatches(it, query) })

/** Compteur de la PASTILLE : jamais négatif — `UNKNOWN_UNREAD` (-1) n'en est pas un. */
fun unreadBadgeCount(d: Discussion): Int = d.unreadCount.coerceAtLeast(0)

/** Total de la pastille d'en-tête : le nombre de fils non lus, pas la somme des compteurs. */
fun unreadTotal(list: List<Discussion>): Int = list.count { unreadBadgeCount(it) > 0 }

/** Fil déjà lu ? Compteur 0 = lu ; compteur non publié (-1) = rien à marquer. */
fun conversationIsRead(d: Discussion): Boolean = d.unreadCount == 0

/** Aperçu d'un dernier message : première ligne, blancs réduits, bornée. */
fun messagePreview(body: String, maxChars: Int = PREVIEW_MAX_CHARS): String {
    val flat = body.replace(Regex("\\s+"), " ").trim()
    if (flat.isEmpty()) return ""
    val bound = maxChars.coerceIn(1, PREVIEW_MAX_BOUND)
    return if (flat.length <= bound) flat else flat.take(bound).trimEnd() + "…"
}

/**
 * Message du COMPTE APPAIRÉ ? Le contrat OMET l'auteur dans ce cas, donc l'app
 * lit une chaîne vide. On ne le devine pas ailleurs : une bulle alignée à droite
 * vaut ce que vaut le champ, et rien de plus.
 */
fun isOwnMessage(m: DiscussionMessage): Boolean = m.authorName.isBlank()

/** Temps relatif d'un fil (« il y a 3 h »), chaîne vide si la date est illisible. */
fun conversationTimeLabel(d: Discussion, nowMillis: Long, zone: ZoneId): String {
    val millis = conversationMillis(d) ?: return ""
    return relativeTimeFr(millis, nowMillis, zone)
}

/** Temps relatif d'un message ; chaîne vide si `sentAt` est illisible. */
fun messageTimeLabel(m: DiscussionMessage, nowMillis: Long, zone: ZoneId): String {
    val millis = discussionMillis(m.sentAt) ?: return ""
    return relativeTimeFr(millis, nowMillis, zone)
}

/**
 * Destinataires groupés par type, dans l'ordre d'affichage, sous des libellés
 * français.
 *
 * Un `kind` hors contrat (défense : `parseRecipients` l'écarte déjà) est regroupé
 * à la FIN, sous [RECIPIENT_KIND_FALLBACK], plutôt que perdu : un destinataire
 * invisible est un fil qui partira sans personne.
 */
fun groupRecipients(recipients: List<DiscussionRecipient>): List<RecipientGroup> {
    if (recipients.isEmpty()) return emptyList()
    val known = RECIPIENT_KIND_ORDER.filter { kind -> recipients.any { it.kind == kind } }
    val extras = recipients.map { it.kind }.distinct().filter { it !in RECIPIENT_KIND_ORDER }
    return (known + extras).map { kind ->
        RecipientGroup(
            kind = kind,
            label = recipientKindFr(kind),
            recipients = recipients.filter { it.kind == kind },
        )
    }
}

/** Un destinataire correspond-il à la recherche ? Nom affiché, texte PLIÉ. */
fun recipientMatches(r: DiscussionRecipient, query: String): Boolean {
    val needle = foldForSearch(query)
    if (needle.isEmpty()) return true
    return foldForSearch(r.displayName).contains(needle)
}

/** Destinataires filtrés, groupes conservés : un groupe vidé disparaît. */
fun searchRecipients(recipients: List<DiscussionRecipient>, query: String): List<RecipientGroup> =
    groupRecipients(recipients.filter { recipientMatches(it, query) })
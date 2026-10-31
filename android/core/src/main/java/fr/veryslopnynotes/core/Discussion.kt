package fr.veryslopnynotes.core

// Messagerie : miroir de shared/contracts/models.ts (Recipient, Message,
// Discussion). Sujet / corps / nom d'expéditeur = DONNÉES bornées, affichées
// par Text() seul (I6).
// ÉCRITURES : actions APP CONFIRMÉES depuis un geste utilisateur, jamais depuis
// une sortie LLM (I7) ; routes du serveur allowlist seul (I1).
// ponytail: dates = 10 premiers caractères de l'ISO ; champ optionnel = "" ou -1.
object DiscussionRules {
    const val MAX_ID = 64
    const val MAX_NAME = 100
    const val MAX_SUBJECT = 200
    const val MAX_PARTICIPANTS = 20
    const val MAX_UNREAD = 999
    const val MAX_BODY = 4000
    /** Pièces jointes par message (miroir ASSIGNMENT_MAX_ATTACHMENTS). */
    const val MAX_ATTACHMENTS = 10

    /** UNKNOWN_UNREAD = l'établissement ne publie pas le compteur (≠ « 0 non lu »). */
    const val UNKNOWN_UNREAD = -1

    val KINDS = listOf("student", "teacher", "administration")

    /** Badge non-lus ; compteur inconnu = aucun badge (jamais « 0 »). */
    fun unreadLabel(count: Int): String =
        if (count > 0) "$count non lu(s)" else ""

    fun participantLabel(participants: List<String>): String =
        if (participants.isEmpty()) "" else participants.joinToString(", ")

    /** Borne de libellé de pièce jointe (miroir ASSIGNMENT_ATTACHMENT_LABEL_MAX_CHARS). */
    const val MAX_ATTACHMENT_LABEL = 200

    /** Borne de `ref` opaque (miroir ASSIGNMENT_REF_MAX_CHARS). */
    const val MAX_ATTACHMENT_REF = 200
}

/**
 * Pièce jointe d'un message : RÉF OPAQUE résolue par le proxy serveur (/v1/media).
 * Toute forme d'adresse est invalide : l'app ne voit JAMAIS d'adresse Pronote (I1).
 */
data class MessageAttachment(
    val id: String,
    val label: String,
    val ref: String,
) {
    fun isValid(): Boolean {
        if (id.isBlank() || id.length > DiscussionRules.MAX_ID) return false
        if (label.isBlank() || label.length > DiscussionRules.MAX_ATTACHMENT_LABEL) return false
        if (ref.isBlank() || ref.length > DiscussionRules.MAX_ATTACHMENT_REF) return false
        return !ref.contains("://") && !ref.startsWith("//") &&
            !ref.contains("data:") && !ref.contains("\\\\")
    }
}

data class DiscussionRecipient(
    val id: String,
    val displayName: String,
    val kind: String,
) {
    fun isValid(): Boolean =
        id.isNotBlank() && id.length <= DiscussionRules.MAX_ID &&
            displayName.isNotBlank() && displayName.length <= DiscussionRules.MAX_NAME &&
            DiscussionRules.KINDS.contains(kind)
}

data class DiscussionMessage(
    val id: String,
    val discussionId: String,
    val authorName: String,
    val body: String,
    val sentAt: String,
    val attachments: List<MessageAttachment> = emptyList(),
) {
    fun isValid(): Boolean =
        id.isNotBlank() && id.length <= DiscussionRules.MAX_ID &&
            discussionId.isNotBlank() && discussionId.length <= DiscussionRules.MAX_ID &&
            authorName.length <= DiscussionRules.MAX_NAME &&
            body.isNotBlank() && body.length <= DiscussionRules.MAX_BODY &&
            attachments.size <= DiscussionRules.MAX_ATTACHMENTS &&
            attachments.all { it.isValid() }
}

data class Discussion(
    val id: String,
    val subject: String,
    val participants: List<String>,
    val unreadCount: Int,
    /** Date du dernier message : "" = inconnue (jamais devinée). */
    val lastMessageAt: String,
    /**
     * Fraîcheur du fil : "" = INCONNUE. Un fil sans fraîcheur EXISTE : il est
     * affiché et se trie sur l'ordre d'arrivée, pas sur une date inventée.
     */
    val updatedAt: String,
) {
    fun isValid(): Boolean =
        id.isNotBlank() && id.length <= DiscussionRules.MAX_ID &&
            subject.isNotBlank() && subject.length <= DiscussionRules.MAX_SUBJECT &&
            participants.size <= DiscussionRules.MAX_PARTICIPANTS &&
            participants.all { it.isNotBlank() && it.length <= DiscussionRules.MAX_NAME } &&
            (unreadCount == DiscussionRules.UNKNOWN_UNREAD || unreadCount in 0..DiscussionRules.MAX_UNREAD)
}
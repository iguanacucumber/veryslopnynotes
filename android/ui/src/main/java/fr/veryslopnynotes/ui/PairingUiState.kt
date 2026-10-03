package fr.veryslopnynotes.ui

import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.data.SseState

// États de l'assistant de connexion (#120). Trois étapes, dans l'ordre où
// l'utilisateur les vit : le serveur, puis son compte EduConnect, puis le QR de
// l'application Pronote. Le contenu servi = donnée affichée, jamais interprété
// (I7 côté app : aucune action déclenchée par du contenu distant).
enum class SetupStep {
    SERVER,
    ACCOUNT,
    QR,
}

sealed interface PairingState {
    data object Idle : PairingState
    data object Submitting : PairingState
    data class Paired(val deviceId: String) : PairingState
    data class Error(val message: String) : PairingState
}

/**
 * Saisie du compte de l'établissement. `state` couvre la dernière action
 * (envoi en cours, échec, succès) ; un échec ne vide JAMAIS la saisie : la
 * corriger est le but de l'écran.
 */
data class SetupForm(
    val schoolUrl: String = "",
    val ent: String = DEFAULT_ENT_KIND,
    val username: String = "",
    val password: String = "",
    val qrRaw: String = "",
    val pin: String = "",
    val state: PairingState = PairingState.Idle,
    val sse: SseState = SseState.Disconnected,
    val lastEventPreview: String? = null,
) {
    /** Méthode « identifiants » complète : c'est ce que l'utilisateur a saisi. */
    val hasCredentials: Boolean
        get() = username.isNotBlank() && password.isNotBlank()
}

/** Seul ENT implémenté côté serveur (les autres sont refusés franchement). */
const val DEFAULT_ENT_KIND = "ninegate"

fun sseLabel(s: SseState): String = when (s) {
    is SseState.Disconnected -> "SSE déconnecté"
    is SseState.Connecting -> "SSE connexion…"
    is SseState.Connected -> "SSE connecté (${s.received} reçus)"
    is SseState.WaitingRetry -> "SSE reconnexion… (essai ${s.attempt}, ${s.delayMs} ms)"
    is SseState.Failed -> "SSE en échec : ${s.message}"
}

fun pairingStateLabel(s: PairingState): String = when (s) {
    is PairingState.Idle -> "Prêt"
    is PairingState.Submitting -> "Connexion à l'établissement…"
    is PairingState.Paired -> "Appareil appairé : ${s.deviceId}"
    is PairingState.Error -> "Erreur : ${s.message}"
}

/** Titre d'étape, pour que l'utilisateur sache toujours où il en est. */
fun setupStepLabel(step: SetupStep): String = when (step) {
    SetupStep.SERVER -> "Étape 1/3 — ton serveur"
    SetupStep.ACCOUNT -> "Étape 2/3 — ton compte EduConnect"
    SetupStep.QR -> "Étape 3/3 — le QR de l'application"
}

/**
 * Honnêteté sur la joignabilité, AVANT l'échec silencieux : l'adresse de
 * départ est l'alias émulateur (qui ne veut rien dire sur un téléphone), et le
 * clair n'est accepté que pour l'émulateur et la boucle locale — donc un
 * téléphone a besoin d'un endpoint https. Le libellé suit l'adresse affichée.
 */
fun serverHint(value: String): String {
    // Hôte seul pour la comparaison : l'adresse affichée porte souvent un port
    // (« http://10.0.2.2:3000 » = défaut émulateur) et `isLoopbackHost`
    // compare par égalité. Affichage uniquement, aucune décision de sécurité.
    val authority = value.trim().substringAfter("://", "").substringBefore('/').trim()
    val host = authority.removePrefix("[").substringBefore(']').substringBefore(':')
    return if (ServerConfig.isLoopbackHost(host)) {
        "Adresse d'émulateur : elle ne fonctionne que dans l'émulateur Android. Sur un téléphone, indiquez l'adresse https de votre serveur."
    } else {
        "Sur un téléphone, utilisez l'adresse https de votre serveur (http est réservé à l'émulateur et à la boucle locale)."
    }
}
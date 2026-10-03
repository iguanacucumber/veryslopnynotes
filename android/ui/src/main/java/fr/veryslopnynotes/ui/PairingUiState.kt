package fr.veryslopnynotes.ui

import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.data.SseState

// États appairage + SSE visibles (#15). Contenu serveur = donnée affichée,
// jamais interprétée (I7 côté app : pas d'action sur contenu flux).
sealed interface PairingState {
    data object Idle : PairingState
    data object Confirming : PairingState
    data class Paired(val deviceId: String) : PairingState
    data class Error(val message: String) : PairingState
}

data class PairingForm(
    val qrRaw: String = "",
    val pin: String = "",
    val state: PairingState = PairingState.Idle,
    val sse: SseState = SseState.Disconnected,
    val lastEventPreview: String? = null,
)

fun sseLabel(s: SseState): String = when (s) {
    is SseState.Disconnected -> "SSE déconnecté"
    is SseState.Connecting -> "SSE connexion…"
    is SseState.Connected -> "SSE connecté (${s.received} reçus)"
    is SseState.WaitingRetry -> "SSE reconnexion… (essai ${s.attempt}, ${s.delayMs} ms)"
    is SseState.Failed -> "SSE en échec : ${s.message}"
}

fun pairingStateLabel(s: PairingState): String = when (s) {
    is PairingState.Idle -> "En attente d'appairage"
    is PairingState.Confirming -> "Vérification du PIN…"
    is PairingState.Paired -> "Appareil appairé : ${s.deviceId}"
    is PairingState.Error -> "Erreur : ${s.message}"
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

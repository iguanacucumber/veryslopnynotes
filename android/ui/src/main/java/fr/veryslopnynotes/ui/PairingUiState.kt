package fr.veryslopnynotes.ui

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

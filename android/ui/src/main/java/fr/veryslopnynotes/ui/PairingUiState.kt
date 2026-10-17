package fr.veryslopnynotes.ui

// États de l'assistant de connexion (#120, repointé #206 : device-only). UNE
// SEULE page (#299) : le QR affiché par l'application Pronote + son PIN. Le QR
// porte l'adresse de l'établissement (`url`), donc plus d'étape de saisie —
// rien à taper à part le PIN. AUCUNE étape « serveur » : il n'y a plus de
// serveur à choisir, le téléphone parle à l'établissement en direct (ADR-003).
// Le contenu servi = donnée affichée, jamais interprété (I7 côté app : aucune
// action déclenchée par du contenu distant).

sealed interface PairingState {
    data object Idle : PairingState
    data object Submitting : PairingState
    data object Paired : PairingState
    data class Error(val message: String) : PairingState
}

/**
 * Saisie de l'écran. `state` couvre la dernière action (envoi en cours, échec,
 * succès) ; un échec ne vide JAMAIS la saisie : la corriger est le but de
 * l'écran.
 *
 * Ni identifiant saisi, ni stocké — la méthode UNIQUE est le QR de
 * l'application + son PIN, tous deux provisoires. La saisie volontairement
 * HORS de `rememberSaveable` (aucun `Saver`) : le QR et son PIN sont la preuve
 * de détention, le premier support d'état d'activité n'est pas pour eux.
 *
 * `toString()` rédigé : le PIN en clair dans un rapport de crash, jamais.
 */
data class SetupForm(
    val qrRaw: String = "",
    val pin: String = "",
    val state: PairingState = PairingState.Idle,
) {
    override fun toString(): String = "SetupForm(qrRaw=***, pin=***, state=$state)"
}

fun pairingStateLabel(s: PairingState): String = when (s) {
    is PairingState.Idle -> "Prêt"
    is PairingState.Submitting -> "Connexion à l'établissement…"
    is PairingState.Paired -> "Appareil appairé"
    is PairingState.Error -> "Erreur : ${s.message}"
}

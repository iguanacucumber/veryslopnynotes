package fr.veryslopnynotes.ui

import fr.veryslopnynotes.core.ServerConfig
import fr.veryslopnynotes.data.SseState

// États de l'assistant de connexion (#120). Trois étapes, dans l'ordre où
// l'utilisateur les vit : le serveur, puis son compte Pronote, puis le QR de
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
// 0.7.0 : plus aucun identifiant saisi (ni stocké) — la méthode UNIQUE est le
// QR de l'application + son PIN, tous deux provisoires.
data class SetupForm(
    val schoolUrl: String = "",
    val qrRaw: String = "",
    val pin: String = "",
    val state: PairingState = PairingState.Idle,
    val sse: SseState = SseState.Disconnected,
    val lastEventPreview: String? = null,
)

fun pairingStateLabel(s: PairingState): String = when (s) {
    is PairingState.Idle -> "Prêt"
    is PairingState.Submitting -> "Connexion à l'établissement…"
    is PairingState.Paired -> "Appareil appairé : ${s.deviceId}"
    is PairingState.Error -> "Erreur : ${s.message}"
}

/** Titre d'étape, pour que l'utilisateur sache toujours où il en est. */
fun setupStepLabel(step: SetupStep): String = when (step) {
    SetupStep.SERVER -> "Étape 1/3 — ton serveur"
    SetupStep.ACCOUNT -> "Étape 2/3 — ton établissement"
    SetupStep.QR -> "Étape 3/3 — le QR de l'application"
}

/**
 * Étape PRÉCÉDENTE, `null` à la première : c'est au retour du haut de
 * l'assistant de décider (remonter d'un cran, ou sortir).
 *
 * #172 : le parcours était un escalier à sens unique — 1 → 2 → 3, aucun retour.
 * Le « Retour » de l'écran appelle `popBackStack`, qui ne peut rien faire au
 * premier lancement (l'appairage EST la route de départ) ni après un 401 (la
 * pile est vidée), donc les étapes 2 et 3 étaient un cul-de-sac : une adresse
 * mal saisie ne pouvait plus être corrigée sans tout ressaisir.
 */
fun previousStep(step: SetupStep): SetupStep? = when (step) {
    SetupStep.SERVER -> null
    SetupStep.ACCOUNT -> SetupStep.SERVER
    SetupStep.QR -> SetupStep.ACCOUNT
}

/**
 * État des notifications en direct, en FRANÇAIS COURANT (#172).
 *
 * « SSE reconnexion… (essai 3, 1500 ms) » était un état d'exécution, lu par un
 * élève au premier lancement : de l'outillage exposé comme de l'interface.
 * L'écart de reprise reste dit (il explique une coupure), en secondes et sans
 * jargon, parce que le délai est la seule chose qu'un utilisateur peut attendre.
 */
fun sseLabel(s: SseState): String = when (s) {
    is SseState.Disconnected -> "Notifications en direct : arrêtées."
    is SseState.Connecting -> "Notifications en direct : connexion…"
    is SseState.Connected -> "Notifications en direct : actives (${s.received} reçues)."
    is SseState.WaitingRetry -> "Notifications en direct : nouvelle tentative dans ${s.delayMs / 1000} s."
    is SseState.Failed -> "Notifications en direct : échec — ${s.message}"
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
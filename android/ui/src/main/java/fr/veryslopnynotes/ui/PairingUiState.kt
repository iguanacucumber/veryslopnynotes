package fr.veryslopnynotes.ui

import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
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

/**
 * Brouillon de l'assistant, SAUVEGARDÉ (#147) : le champ SAISI qui n'est pas un
 * credential, et rien d'autre.
 *
 * Des champs sont volontairement absents :
 *
 *  - `qrRaw` et `pin`. Le QR est le contenu `login` + `jeton` chiffrés dont la
 *    clé EST le PIN : les deux ensemble sont la preuve de détention, et le
 *    serveur ne les garde que le temps de la session. Les écrire dans l'état
 *    d'activité (donc dans un support que l'utilisateur ne surveille pas) serait
 *    la première PERSISTANCE de ce credential dans l'app — le contraire de la
 *    règle « provisoire, jamais stocké ». Le coût est un rescane après rotation,
 *    et l'étape atteinte est restaurée : l'utilisateur retombe sur l'étape 3,
 *    pas sur le champ serveur.
 *  - `state`, `sse` et `lastEventPreview` : états de MACHINE (un envoi en
 *    cours, une connexion SSE). Restaurer « Connexion… » afficherait un écran
 *    figé sur une requête morte, donc ils repartent à leur valeur initiale.
 */
val SetupFormSaver: Saver<SetupForm, Any> = listSaver(
    save = { listOf(it.schoolUrl) },
    restore = { SetupForm(schoolUrl = it[0]) },
)

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
    SetupStep.ACCOUNT -> "Étape 2/3 — ton établissement"
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
package fr.veryslopnynotes.ui

import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver

// États de l'assistant de connexion (#120, repointé #206 : device-only). Deux
// étapes, dans l'ordre où l'utilisateur les vit : l'adresse de son
// établissement, puis le QR de l'application Pronote + son PIN. AUCUNE étape
// « serveur » : il n'y a plus de serveur à choisir, le téléphone parle à
// l'établissement en direct (ADR-003). Le contenu servi = donnée affichée,
// jamais interprété (I7 côté app : aucune action déclenchée par du contenu distant).
enum class SetupStep {
    SCHOOL,
    QR,
}

sealed interface PairingState {
    data object Idle : PairingState
    data object Submitting : PairingState
    data object Paired : PairingState
    data class Error(val message: String) : PairingState
}

/**
 * Saisie de l'établissement. `state` couvre la dernière action
 * (envoi en cours, échec, succès) ; un échec ne vide JAMAIS la saisie : la
 * corriger est le but de l'écran.
 */
// Ni identifiant saisi, ni stocké — la méthode UNIQUE est le QR de
// l'application + son PIN, tous deux provisoires.
//
// `toString()` rédigé : le PIN en clair dans un rapport de crash, jamais.
data class SetupForm(
    val schoolUrl: String = "",
    val qrRaw: String = "",
    val pin: String = "",
    val state: PairingState = PairingState.Idle,
) {
    override fun toString(): String = "SetupForm(schoolUrl=$schoolUrl, qrRaw=***, pin=***, state=$state)"
}

/**
 * Brouillon de l'assistant, SAUVEGARDÉ (#147) : le champ SAISI qui n'est pas un
 * credential, et rien d'autre.
 *
 * Des champs sont volontairement absents :
 *
 *  - `qrRaw` et `pin`. Le QR est le contenu `login` + `jeton` chiffrés dont la
 *    clé EST le PIN : les deux ensemble sont la preuve de détention, et le
 *    téléphone ne les garde que le temps de la session. Les écrire dans l'état
 *    d'activité (donc dans un support que l'utilisateur ne surveille pas) serait
 *    la première PERSISTANCE de ce credential dans l'app — le contraire de la
 *    règle « provisoire, jamais stocké ». Le coût est un rescane après rotation,
 *    et l'étape atteinte est restaurée : l'utilisateur retombe sur l'étape 2,
 *    pas sur le champ de l'établissement.
 *  - `state` : état de MACHINE (un envoi en cours). Restaurer
 *    « Connexion… » afficherait un écran figé sur une requête morte, donc il
 *    repart à sa valeur initiale.
 */
val SetupFormSaver: Saver<SetupForm, Any> = listSaver(
    save = { listOf(it.schoolUrl) },
    restore = { SetupForm(schoolUrl = it[0]) },
)

fun pairingStateLabel(s: PairingState): String = when (s) {
    is PairingState.Idle -> "Prêt"
    is PairingState.Submitting -> "Connexion à l'établissement…"
    is PairingState.Paired -> "Appareil appairé"
    is PairingState.Error -> "Erreur : ${s.message}"
}

/** Titre d'étape, pour que l'utilisateur sache toujours où il en est. */
fun setupStepLabel(step: SetupStep): String = when (step) {
    SetupStep.SCHOOL -> "Étape 1/2 — ton établissement"
    SetupStep.QR -> "Étape 2/2 — le QR de l'application"
}

/**
 * Étape PRÉCÉDENTE, `null` à la première : c'est au retour du haut de
 * l'assistant de décider (remonter d'un cran, ou sortir).
 *
 * #172 : le parcours était un escalier à sens unique — 1 → 2 → 3, aucun retour.
 * Le « Retour » de l'écran appelle `popBackStack`, qui ne peut rien faire au
 * premier lancement (l'appairage EST la route de départ) ni après une session
 * morte (la pile est vidée), donc l'étape 2 était un cul-de-sac : une adresse
 * mal saisie ne pouvait plus être corrigée sans tout ressaisir.
 */
fun previousStep(step: SetupStep): SetupStep? = when (step) {
    SetupStep.SCHOOL -> null
    SetupStep.QR -> SetupStep.SCHOOL
}

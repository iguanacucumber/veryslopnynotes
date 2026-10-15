package fr.veryslopnynotes.ui

import fr.veryslopnynotes.data.CachedEntry
import fr.veryslopnynotes.data.RefreshOutcome

// Etat ecran offline-first. Un seul chargement initial (cache synchrone),
// jamais de spinner infini : echec AVEC cache = Error (lignes gardees,
// cause en une ligne), echec SANS cache = Empty (etat vide propre +
// Actualiser). Aucun ecran d'erreur plein-ecran pour l'absence de
// connexion (#260) : la session morte remonte par DeviceAuth (retour
// appairage), pas par un « Hors-ligne, … ».
// Contenu serveur = donnee affichee, jamais interpretee.
sealed interface UiState {
    data object Loading : UiState
    data class Data(val payload: String, val isStale: Boolean, val fetchedAt: Long) : UiState
    data object Empty : UiState
    data class Error(val message: String, val cached: String?) : UiState
}

// #147 : `Data.payload` et `Error.cached` ne sont JAMAIS passés à un
// `rememberSaveable`. Ce sont des PAYLOADS serveur (jusqu'à des centaines de
// kilo-octets), donc les écrire dans l'état d'activité Android finit en
// `TransactionTooLargeException` au moment le moins utile — et ils sont de toute
// façon re-lus du cache synchrone au montage. Ce qui se sauvegarde, c'est l'état
// de saisie : brouillons, semaine, période, filtre (cf. chaque écran).
//
// ponytail: mapping centralise outcome/store -> etat (pas de logique en Composable).
fun uiStateFromCache(entry: CachedEntry?, stale: Boolean): UiState =
    if (entry == null) UiState.Empty else UiState.Data(entry.payload, stale, entry.fetchedAt)
fun uiStateFromOutcome(o: RefreshOutcome): UiState = when (o) {
    is RefreshOutcome.Updated -> UiState.Data(o.payload, false, o.fetchedAt)
    is RefreshOutcome.OfflineFallback -> UiState.Data(o.payload, o.stale, o.fetchedAt)
    is RefreshOutcome.Failed ->
        if (o.cachedPayload != null) UiState.Error(o.message, o.cachedPayload)
        else UiState.Empty
}

/**
 * Messages d'absence de connexion : jamais d'écran d'erreur, jamais de
 * bandeau (#260). L'écran sans donnée montre son état vide + « Actualiser »,
 * l'écran avec donnée garde ses lignes (la cause passe en une ligne quand
 * elle est réelle, en silence quand c'est l'absence de connexion).
 */
fun isSilentOffline(message: String): Boolean = message in setOf(
    "Aucune donnée en cache.",
    "Tranches indisponibles.",
    "Serveur non configuré.",
    "Relecture indisponible.",
)

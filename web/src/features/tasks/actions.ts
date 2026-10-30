/**
 * État des trois actions payantes d'une carte de devoir.
 *
 * Un seul assistant peut être en vol pour tout l'écran : un second appel
 * jetterait la première réponse tout en la payant.
 */
export interface CardActionFlags {
  assistantDisabled: boolean;
  /** Manuel ou cours disponible pour CETTE matière (aide texte seulement). */
  hasMaterial: boolean;
  /** La carte affiche déjà un panneau (fermable). */
  hasPanel: boolean;
  /** Le panneau de CETTE carte attend une réponse. */
  helpLoading: boolean;
  /** Le panneau en attente vient d'une photo. */
  helpPhoto: boolean;
  /** Un assistant est en vol, sur n'importe quelle carte de l'écran. */
  assistantBusy: boolean;
}

/**
 * Pendant une demande, les actions des AUTRES cartes sont fermées ; le bouton
 * du panneau EN VOL garde son rôle « Fermer » (la demande reste annulable).
 * Le drapeau retombe avec `loading` (réponse, erreur, annulation).
 */
export function cardActionFlags(state: CardActionFlags): {
  textOff: boolean;
  photoOff: boolean;
  sheetOff: boolean;
} {
  const textOff = state.assistantDisabled || !state.hasMaterial;
  const loadingPanel = state.hasPanel && state.helpLoading;
  return {
    textOff: textOff || (state.assistantBusy && !(loadingPanel && !state.helpPhoto)),
    photoOff:
      state.assistantDisabled || (state.assistantBusy && !(loadingPanel && state.helpPhoto)),
    sheetOff: textOff || state.assistantBusy,
  };
}

// Fixtures manuels 100 % synthétiques (issue #25, phase 8).
// Aucune URL réelle, aucune credential, aucune donnée perso : plateforme,
// titres et extraits inventés, hôte example.invalid uniquement en commentaire.
// Ne jamais y mettre de secret, d'URL d'établissement ou de session.

export const syntheticManualPlatform = "editeur-fake";

// Compte faux pour tests config (jamais réel, jamais stocké nulle part côté serveur).
export const syntheticManualAccount = {
  platform: syntheticManualPlatform,
  username: "fake-manual-user-UNREAL",
  password: "fake-manual-pw-9x8y7z-UNREAL",
};

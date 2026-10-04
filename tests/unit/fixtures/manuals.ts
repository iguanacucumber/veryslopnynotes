// Fixtures manuels 100 % synthétiques (issue #25, phase 8).
// Aucune URL réelle, aucune credential, aucune donnée perso : plateforme,
// titres et extraits inventés, hôte example.invalid uniquement en commentaire.
// Ne jamais y mettre de secret, d'URL d'établissement ou de session.
import type { ManualDoc } from "../../../server/infrastructure/manuals";

export const syntheticManualPlatform = "editeur-fake";

export const syntheticManualDocs: ManualDoc[] = [
  {
    id: "manuel-fake-maths-6e",
    platform: syntheticManualPlatform,
    title: "Maths-Fake 6e",
    subject: "Maths-Fake",
    page: 42,
    excerpt:
      "Synthetic fractions lesson : half plus quarter equals three quarters. " +
      "Worked example with fake numbers only, no real student data.",
  },
  {
    id: "manuel-fake-francais-5e",
    platform: syntheticManualPlatform,
    title: "Francais-Fake 5e",
    subject: "Francais-Fake",
    page: 17,
    excerpt:
      "Synthetic grammar lesson : le passé composé se forme avec un auxiliaire faux-exemple. " +
      "Phrases inventées pour tests, anonymisées.",
  },
];

// Compte faux pour tests config (jamais réel, jamais stocké nulle part côté serveur).
export const syntheticManualAccount = {
  platform: syntheticManualPlatform,
  username: "fake-manual-user-UNREAL",
  password: "fake-manual-pw-9x8y7z-UNREAL",
};

// Fenêtre de fraîcheur d'une entrée : un widget monté plus tard apparaît SANS
// entrée (une entrée tardive est une faute d'affichage, pas un effet).
export const ENTRANCE_WINDOW_MS = 400;

/** Décision pure, figée au montage : la rejouer couperait l'animation en cours. */
export function shouldAnimateOnMount(openedAt: number, mountedAt: number): boolean {
  if (!Number.isFinite(openedAt) || !Number.isFinite(mountedAt)) return false;
  return mountedAt - openedAt <= ENTRANCE_WINDOW_MS;
}

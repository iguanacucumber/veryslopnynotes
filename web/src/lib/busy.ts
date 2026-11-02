// Compteur de lectures en cours, partagé par les écrans montés : la rotation
// de l'en-tête suit la fin RÉELLE des requêtes, jamais un délai fixe.
type BusyListener = (busy: boolean) => void;

let active = 0;
const listeners = new Set<BusyListener>();

function emit(): void {
  const busy = active > 0;
  for (const listener of listeners) listener(busy);
}

/** Démarre une lecture ; la fonction rendue la termine une seule fois. */
export function beginBusy(): () => void {
  active += 1;
  if (active === 1) emit();
  let released = false;
  return () => {
    if (released || active === 0) return;
    released = true;
    active -= 1;
    if (active === 0) emit();
  };
}

export function isBusy(): boolean {
  return active > 0;
}

export function subscribeBusy(listener: BusyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

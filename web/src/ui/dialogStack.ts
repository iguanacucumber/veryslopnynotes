/** Pile des dialogues ouverts, dans l'ordre d'ouverture (le dernier est dessus). */
type CloseDialog = () => void;

const stack: CloseDialog[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Enregistre un dialogue ouvert ; la fermeture rend la fonction de retrait. */
export function registerDialog(close: CloseDialog): () => void {
  stack.push(close);
  emit();
  return () => {
    const index = stack.indexOf(close);
    if (index === -1) return;
    stack.splice(index, 1);
    emit();
  };
}

/** Ferme le dialogue du dessus. `true` si un dialogue était ouvert. */
export function closeTopDialog(): boolean {
  const close = stack[stack.length - 1];
  if (!close) return false;
  close();
  return true;
}

export function dialogCount(): number {
  return stack.length;
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

import { useEffect, useState } from "react";

/**
 * Horloge de l'écran, relue à intervalle borné. Seuls les compteurs à rebours et
 * « En cours » en dépendent ; les parseurs, eux, restent mémoïsés par payload.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), Math.max(15_000, intervalMs));
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

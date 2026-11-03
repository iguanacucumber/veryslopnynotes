import { useEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bridge } from "../bridge/client";
import { decideBack } from "../lib/back";
import { metaFor } from "./AppShell";
import { closeTopDialog, dialogCount, subscribeDialogs } from "./dialogStack";

declare global {
  interface Window {
    /** Appelé par le natif sur le bouton retour ; `true` = consommé. */
    __vsnBack?: () => boolean;
  }
}

/**
 * Contrat unique du retour matériel : le natif appelle [window.__vsnBack] et
 * n'agit que si le JS ne consomme pas la pression. La disponibilité est
 * poussée au natif pour que, à l'accueil, le système garde la main (animation
 * prédictive) au lieu d'être intercepté puis terminé.
 */
export function BackNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const dialogs = useSyncExternalStore(subscribeDialogs, dialogCount);
  const available = dialogs > 0 || location.pathname !== "/";

  useEffect(() => {
    const onBack = (): boolean => {
      const decision = decideBack({
        dialogs: dialogCount(),
        pathname: location.pathname,
        metaBack: metaFor(location.pathname).back,
      });
      if (decision.kind === "dialog") return closeTopDialog();
      if (decision.kind === "route") {
        if (location.key !== "default" && window.history.length > 1) navigate(-1);
        else navigate(decision.fallback, { replace: true });
        return true;
      }
      return false;
    };
    window.__vsnBack = onBack;
    return () => {
      if (window.__vsnBack === onBack) delete window.__vsnBack;
    };
  }, [location.pathname, location.key, navigate]);

  useEffect(() => {
    void bridge.backState(available).catch(() => undefined);
  }, [available]);

  return null;
}

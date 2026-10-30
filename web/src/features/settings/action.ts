import { BridgeCallError } from "../../bridge/types";

/**
 * Erreur du pont -> phrase actionnable. `auth_required` prévient l'app (elle
 * repart vers l'appairage) ; tout le reste garde le repli de l'appelant.
 */
export function actionMessage(error: unknown, fallback: string): string {
  if (error instanceof BridgeCallError) {
    if (error.code === "auth_required") {
      window.dispatchEvent(new Event("vsn:auth"));
      return "Session expirée : rescane le QR de l'établissement.";
    }
    if (error.code === "unavailable") return "Téléphone injoignable : réessaie dans un instant.";
  }
  return fallback;
}

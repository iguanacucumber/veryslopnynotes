import { BridgeCallError } from "../../bridge/types";

/** Erreur du pont -> phrase actionnable ; `auth_required` repart vers l'appairage. */
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

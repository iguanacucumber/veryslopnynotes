// Fixture d'appairage pour les tests qui pilotent le routeur : depuis 0.4.0
// TOUTE route hors appairage + /v1/health exige le bearer d'un device appairé.
// On refait donc le VRAI parcours d'un device (start -> confirm), comme le
// ferait l'app : PIN et token synthétiques, aucun secret réel, aucun réseau.
// Le secret ne sort qu'à la confirmation (unique endroit de toute l'API).
import { PairingService } from "../../../server/api/pairing";

export interface PairedDevice {
  /** Service à injecter dans `createHandler`/`serve` : c'est LUI qui connaît le device. */
  readonly pairing: PairingService;
  /** Secret présenté en Bearer (jamais journalisé, jamais persisté en clair). */
  readonly token: string;
  /** En-tête à poser sur chaque requête : `new Request(url, { headers: auth })`. */
  readonly auth: { readonly authorization: string };
}

export function pairedDevice(): PairedDevice {
  const pairing = new PairingService({
    pin: () => "123456",
    token: () => "jeton-appaire-synthetique-1",
  });
  const started = pairing.start("pixel-test");
  const confirmed = pairing.confirm(started.sessionId, started.code);
  if (!confirmed.ok) throw new Error("appairage de test impossible");
  return { pairing, token: confirmed.token, auth: { authorization: `Bearer ${confirmed.token}` } };
}

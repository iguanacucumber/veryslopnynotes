// Le bouton « Connexion démo » de l'écran d'appairage.
//
// L'écran d'appairage propose une porte de sortie SANS établissement : un clic
// ouvre la session sur l'établissement de démonstration public (ni QR, ni PIN).
// Ce qui compte ici :
//   1. le GESTE reste clair : le message d'échec dit quoi faire, et il ne
//      parle PAS de QR (la démo n'en demande aucun) ;
//   2. le passage se fait par le PONT (le web ne parle jamais à
//      l'établissement) ;
//   3. le texte de l'écran ne NOMME pas l'hôte (le web n'a pas le droit d'en
//      savoir : `tests/architecture/web.test.ts` le vérifie).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoErrorMessage } from "../../web/src/features/pairing/model";

const ROOT = join(import.meta.dir, "..", "..");
const SCREEN = join(ROOT, "web", "src", "features", "pairing", "PairingScreen.tsx");
const CLIENT = join(ROOT, "web", "src", "bridge", "client.ts");
const MOCK = join(ROOT, "web", "src", "bridge", "mock.ts");

/** Un hôte, une IP ou un port ne doivent jamais sortir d'un message d'interface. */
const HOST = /\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}\b/i;
const IPV4 = /(?:\d{1,3}\.){3}\d{1,3}/;
const PORT = /:\d{2,5}\b/;
const URL = /:\/\//;

describe("connexion à l'établissement de démonstration", () => {
  test("un échec dit un geste, sans nommer d'hôte", () => {
    for (const code of ["demo_failed", "network", "auth_required", "unavailable", "inconnu"]) {
      const message = demoErrorMessage(code);
      expect({ code, vide: message.trim() === "" }).toEqual({ code, vide: false });
      expect(message).not.toMatch(IPV4);
      expect(message).not.toMatch(PORT);
      expect(message).not.toMatch(URL);
      expect(message).not.toMatch(HOST);
      // Le QR n'est pas en jeu dans la démo : on ne dit jamais « rescane ».
      expect(message.toLowerCase()).not.toContain("rescane");
    }
  });

  test("un code inconnu retombe sur une phrase, jamais sur un code brut", () => {
    const message = demoErrorMessage("ce_que_vous_voulez");
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain("ce_que_vous_voulez");
  });

  test("l'écran propose le bouton et il passe par le pont", () => {
    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain("Connexion démo");
    expect(screen).toContain("bridge.pairDemo()");
    // Un bouton de plus, PAS un envoi de formulaire : le formulaire de
    // l'appairage reste réservé au QR + PIN.
    expect(screen).toMatch(/type="button"[^>]*[\s\S]{0,400}Connexion démo/);
    // La session s'ouvre côté web comme après un appairage.
    expect(screen).toContain("openSession()");
  });

  test("le pont expose la méthode, et le factice de développement aussi", () => {
    const client = readFileSync(CLIENT, "utf8");
    expect(client).toContain('call<PairResult>("pairing.pairDemo")');
    const mock = readFileSync(MOCK, "utf8");
    expect(mock).toContain('case "pairing.pairDemo"');
  });
});

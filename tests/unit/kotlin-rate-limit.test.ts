// Limitation de débit de l'établissement (`G=25` / HTTP 429) : la boucle
// « G=25 → refresh → login → G=25 » est cassée et la fenêtre de calme expire.
// Le vrai `ClientBase.sendWithRefresh` et `RateLimitGate` sont EXÉCUTÉS.
// Outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "RateLimitParityMain.kt");
const CLIENT = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/Client.kt");
const COMMUNICATION = join(
  ROOT,
  "android/pronote/src/main/java/fr/veryslopnynotes/pronote/Communication.kt",
);

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface GateResult {
  coolingBefore: boolean;
  coolingAfterTrip: boolean;
  remainingAfterTrip: number;
  during: string | null;
  coolingBeforeExpiry: boolean;
  extended: number;
  coolingAtOldExpiry: boolean;
  stillDuring: string | null;
  coolingAfterExpiry: boolean;
  after: string | null;
}

interface ClientResult {
  sends: number;
  refreshes: number;
  first?: string | null;
  second?: string | null;
  error?: string | null;
}

async function run<T>(op: string): Promise<T> {
  return JSON.parse(await link!.ask({ op })) as T;
}

describe("porte de limitation de débit", () => {
  test.skipIf(skip)("la fenêtre s'arme, refuse tout de suite, puis se lève seule", async () => {
    const g = await run<GateResult>("gate");
    expect(g.coolingBefore).toBe(false);
    expect(g.coolingAfterTrip).toBe(true);
    expect(g.remainingAfterTrip).toBe(120_000);
    // Pendant la fenêtre : le TYPE, pas une erreur générique.
    expect(g.during).toBe("RateLimitedError");
    expect(g.coolingBeforeExpiry).toBe(true);
    // Un second refus PROLONGE la fenêtre, il ne la raccourcit jamais.
    expect(g.extended).toBe(120_000);
    expect(g.coolingAtOldExpiry).toBe(true);
    expect(g.stillDuring).toBe("RateLimitedError");
    // À l'échéance : plus de blocage, sans redémarrage de l'app.
    expect(g.coolingAfterExpiry).toBe(false);
    expect(g.after).toBeNull();
  });

  test.skipIf(skip)("G=25 ne déclenche AUCUN refresh et la requête suivante repart sans réseau", async () => {
    const r = await run<ClientResult>("noRefreshOnRateLimit");
    // Un refresh = un login de plus : UN envoi, ZÉRO refresh.
    expect(r.sends).toBe(1);
    expect(r.refreshes).toBe(0);
    expect(r.first).toBe("RateLimitedError");
    // La porte est armée : la lecture suivante échoue localement.
    expect(r.second).toBe("RateLimitedError");
    expect(r.sends).toBe(1);
    expect(r.refreshes).toBe(0);
  });

  test.skipIf(skip)("un rate-limit PENDANT le refresh arme la porte", async () => {
    const r = await run<ClientResult>("refreshRateLimited");
    // Un refresh sur la limite remonte typée, et rien ne repart ensuite.
    expect(r.sends).toBe(1);
    expect(r.refreshes).toBe(1);
    expect(r.first).toBe("RateLimitedError");
    expect(r.second).toBe("RateLimitedError");
    expect(r.sends).toBe(1);
    expect(r.refreshes).toBe(1);
  });

  test.skipIf(skip)("un rate-limit au REJEU arme la porte", async () => {
    const r = await run<ClientResult>("retryRateLimited");
    // Envoi 1 : erreur générique -> refresh. Envoi 2 (rejeu) : refus de débit.
    expect(r.sends).toBe(2);
    expect(r.refreshes).toBe(1);
    expect(r.first).toBe("RateLimitedError");
    // Puis plus rien : pas de troisième tentative.
    expect(r.second).toBe("RateLimitedError");
    expect(r.sends).toBe(2);
    expect(r.refreshes).toBe(1);
  });

  test.skipIf(skip)("une erreur GÉNÉRIQUE rafraîchit et rejoue encore", async () => {
    const r = await run<ClientResult>("genericRefreshRetried");
    // Pas de régression : seule la limitation de débit est spéciale.
    expect(r.sends).toBe(2);
    expect(r.refreshes).toBe(1);
    expect(r.error).toBeNull();
  });

  test.skipIf(skip)("les lectures tolérantes remontent rate-limit et session morte", async () => {
    const r = await run<Record<string, boolean>>("propagate");
    expect(r["rateLimited"]).toBe(true);
    // Pas de purge de cache ni de retour à l'appairage : attendre suffit.
    expect(r["rateLimitedSession"]).toBe(false);
    expect(r["sessionExpired"]).toBe(true);
    // Une erreur générique ou de parsing reste avalée : un trimestre partiel reste affichable.
    expect(r["generic"]).toBe(false);
    expect(r["parsing"]).toBe(false);
    // Un objet périmé (G=22) n'est pas une session morte (#485).
    expect(r["expired"]).toBe(false);
    expect(r["io"]).toBe(false);
  });

  test("le client vérifie la porte AVANT d'envoyer", () => {
    const client = readFileSync(CLIENT, "utf8");
    // Le `check()` précède le `send` : aucun octet ne part pendant la fenêtre.
    const check = client.indexOf("rateLimitGate.check()");
    const send = client.indexOf("return send(functionName, postData)");
    expect(check).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(check);
    // Le rate-limit ne passe jamais par le refresh.
    expect(client).toContain("catch (e: RateLimitedError)");
  });

  test("G=25 et HTTP 429 sont traduits en RateLimitedError", () => {
    const communication = readFileSync(COMMUNICATION, "utf8");
    expect(communication).toContain("if (gInt == 25) throw RateLimitedError");
    expect(communication).toContain("HTTP_TOO_MANY_REQUESTS");
    expect(communication).toContain("response.status == HTTP_TOO_MANY_REQUESTS");
  });
});

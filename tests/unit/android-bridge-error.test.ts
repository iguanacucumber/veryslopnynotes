// #394 : un `Error` (et non une `Exception`) levé pendant un appel du pont
// ne doit JAMAIS laisser la promesse JS pendante.
//
// Un `Error` non capturé tue le fil du worker SANS `resolve` ni `reject` : la
// promesse `pending[requestId]` n'est jamais réglée et l'interface bloque sur
// un chargement infini, sans message (pour `pairing.scanQr`, dont le délai JS
// est 0, elle pendait POUR TOUJOURS).
//
// Ce test ne Miroite pas la logique : il COMPILE la VRAIE source de production
// (`android/app/.../BridgeErrors.kt`) et la pilote via
// `agents/runtime/kotlin-parity/BridgeErrorsParityMain.kt`. Les assertions
// portent donc sur du code exécuté.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "BridgeErrorsParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

/** Les codes de rejet que l'UI sait traiter (`web/src/bridge/types.ts`). */
const CODES = new Set(["auth_required", "bad_request", "unavailable", "unknown"]);

/** Les genres d'échec natif que le pont doit savoir traduire. */
const GENRES = ["error", "out_of_memory", "stack_overflow", "runtime"] as const;

interface Rejet {
  rejected: boolean;
  code?: string;
  message?: string;
}

/** Un appel du pont qui lève l'échec `genre` : le pont doit RÉPONDRE. */
async function appel(genre: string, message = "échec natif"): Promise<Rejet> {
  const res = JSON.parse(await link!.ask({ op: "call", kind: genre, message })) as Rejet;
  return res;
}

/** La traduction de l'échec `genre`, sans passer par l'appel. */
async function traduction(genre: string, message = "échec natif"): Promise<Rejet> {
  const res = JSON.parse(await link!.ask({ op: "error", kind: genre, message })) as Rejet;
  return res;
}

describe("pont : un échec natif devient toujours un rejet (#394)", () => {
  test.skipIf(skip)("un `Error` levé pendant un appel est rejeté, jamais pendant", async () => {
    for (const genre of GENRES) {
      const rejet = await appel(genre);
      // Le pont RÉPOND : la promesse est réglée (pas de chargement infini).
      expect({ genre, rejected: rejet.rejected }).toEqual({ genre, rejected: true });
      // Le code est un code que l'UI sait traiter, le message est non vide.
      expect(CODES.has(rejet.code ?? "")).toBe(true);
      expect((rejet.message ?? "").trim()).not.toBe("");
    }
  });

  test.skipIf(skip)("un `Error` ne s'échappe JAMAIS du fil du worker", async () => {
    // Si l'exception s'échappait, le pilote mourrait (le harnais le verrait :
    // pas de réponse). Le fait de recevoir une réponse prouve que le pont a
    // attrapé l'échec.
    const rejet = await appel("error", "boom");
    expect(rejet.rejected).toBe(true);
    // Le pilote survit : un appel suivant répond encore.
    expect((await appel("runtime")).rejected).toBe(true);
  });

  test.skipIf(skip)("le message brut de l'échec ne sort JAMAIS", async () => {
    // Le message d'une exception peut nommer un hôte, un compte, une URL :
    // il ne franchit pas la frontière native/JS.
    const brut = "échec sur 10.0.0.1:8080 jeton=secret";
    for (const genre of GENRES) {
      const rejet = await appel(genre, brut);
      expect(rejet.message ?? "").not.toContain("10.0.0.1");
      expect(rejet.message ?? "").not.toContain("secret");
      expect(rejet.message ?? "").not.toContain("jeton");
    }
  });

  test.skipIf(skip)("le message du rejet est borné et tient sur une ligne", async () => {
    for (const genre of GENRES) {
      const rejet = await traduction(genre, "x".repeat(5000));
      expect((rejet.message ?? "").length).toBeLessThanOrEqual(200);
      expect(rejet.message ?? "").not.toMatch(/[\n\r]/);
    }
  });

  test.skipIf(skip)("la mémoire épuisée est un `unavailable`, pas une cause affirmée à tort", async () => {
    // La cause est CERTAINE (c'est un `OutOfMemoryError`) : le pont peut
    // dire « réessaie ». Une cause inventée serait pire qu'aucune cause.
    const rejet = await traduction("out_of_memory");
    expect(rejet.code).toBe("unavailable");
    expect((rejet.message ?? "").trim()).not.toBe("");
  });

  test.skipIf(skip)("un échec ATTENDU garde son code et sa phrase", async () => {
    // `BridgeFailure` : le pont a choisi son code et sa phrase (ex. « QR et
    // PIN requis. ») — la traduction ne doit pas l'écraser par « Erreur
    // native. ».
    const rejet = await traduction("bridge_failure", "Requête invalide.");
    expect(rejet.code).toBe("bad_request");
    expect(rejet.message).toBe("Requête invalide.");
  });
});

// Un `Error` levé pendant un appel du pont ne doit JAMAIS laisser la promesse JS
// pendante : le fil du worker meurt sans `resolve` ni `reject`.
// La VRAIE source est compilée et pilotée ; outillage absent = SKIP BRUYANT.
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
    // Recevoir une réponse prouve que le pont a attrapé l'échec.
    const rejet = await appel("error", "boom");
    expect(rejet.rejected).toBe(true);
    // Le pilote survit : un appel suivant répond encore.
    expect((await appel("runtime")).rejected).toBe(true);
  });

  test.skipIf(skip)("le message brut de l'échec ne sort JAMAIS", async () => {
    // Le message d'une exception peut nommer un hôte ou une URL : il ne franchit pas la frontière.
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
    // Cause CERTAINE (`OutOfMemoryError`) : le pont peut dire « réessaie ».
    const rejet = await traduction("out_of_memory");
    expect(rejet.code).toBe("unavailable");
    expect((rejet.message ?? "").trim()).not.toBe("");
  });

  test.skipIf(skip)("un échec ATTENDU garde son code et sa phrase", async () => {
    // `BridgeFailure` : le pont a choisi son code et sa phrase, la traduction ne l'écrase pas.
    const rejet = await traduction("bridge_failure", "Requête invalide.");
    expect(rejet.code).toBe("bad_request");
    expect(rejet.message).toBe("Requête invalide.");
  });
});

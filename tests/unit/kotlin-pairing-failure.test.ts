// Une fixture par cause d'échec d'appairage (#877) : le TYPE de l'exception
// donne le code du pont, jamais un mot du message. Le VRAI Kotlin est exécuté ;
// outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pairErrorMessage } from "../../web/src/features/pairing/model";
import { PAIRING_CAUSES } from "./fixtures/pairing-causes";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const FAILURE = join(
  ROOT,
  "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data", "PairingFailure.kt",
);
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PairingFailureParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

/** Cause rendue par le VRAI Kotlin pour une exception décrite par la fixture. */
async function cause(testCase: (typeof PAIRING_CAUSES)[number]): Promise<string> {
  const { cause: _cause, why: _why, ...op } = testCase;
  const res = JSON.parse(await link!.ask({ op: "cause", ...op })) as { cause?: string };
  return res.cause ?? "";
}

/** Codes de l'enum, lus dans sa source : une fixture par cause est obligatoire. */
function enumCodes(): string[] {
  const src = readFileSync(FAILURE, "utf8");
  return [...src.matchAll(/^ {4}[A-Z_]+\(\s*"([a-z_]+)"/gm)].map((m) => m[1]!);
}

const FALLBACK = pairErrorMessage("__cause_inconnue__");

describe("cause typée d'un échec d'appairage (#877)", () => {
  test.skipIf(skip)("chaque fixture donne le code attendu", async () => {
    for (const testCase of PAIRING_CAUSES) {
      expect({ kind: testCase.kind, status: testCase.status, cause: await cause(testCase) }).toEqual({
        kind: testCase.kind,
        status: testCase.status,
        cause: testCase.cause,
      });
    }
  });

  test.skipIf(skip)("le TEXTE ne classe jamais : un message d'identifiants reste « établissement muet »", async () => {
    const piège = PAIRING_CAUSES.find((c) => c.kind === "other");
    expect(piège?.cause).toBe("school_unreachable");
    expect(await cause(piège!)).toBe("school_unreachable");
  });

  test("une fixture couvre CHAQUE cause de l'enum", () => {
    const codes = enumCodes();
    expect(codes.length).toBeGreaterThan(0);
    const couverts = new Set(PAIRING_CAUSES.map((c) => c.cause));
    for (const code of codes) {
      expect({ code, couvert: couverts.has(code) }).toEqual({ code, couvert: true });
    }
  });

  test("chaque cause a SA phrase web, jamais le repli", () => {
    for (const code of enumCodes()) {
      const m = pairErrorMessage(code);
      expect({ code, vide: m.trim() === "" }).toEqual({ code, vide: false });
      expect({ code, repli: m === FALLBACK }).toEqual({ code, repli: false });
      expect({ code, ip: /(?:\d{1,3}\.){3}\d{1,3}/.test(m) }).toEqual({ code, ip: false });
      expect({ code, url: /:\/\//.test(m) }).toEqual({ code, url: false });
    }
  });

  test("la couche data ne classe plus par un mot du message", () => {
    const pairing = readFileSync(
      join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data", "PairingRepository.kt"),
      "utf8",
    );
    expect(pairing).not.toContain("isLoginRefused");
    expect(pairing).not.toContain("message.isNotBlank");
  });
});

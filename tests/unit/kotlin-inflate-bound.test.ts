// `inflateRaw` n'avait aucun plafond de sortie : ≤ 10 Mo de ciphertext
// pouvaient gonfler à plusieurs Go (`OutOfMemoryError` non attrapé). Le test
// exécute la VRAIE inflation : au-delà de MAX_RESPONSE_BYTES, erreur propre.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const PRONOTE = join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CompressionMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(() => {
  link?.close();
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

describe("l'inflation deflate est bornée (#785)", () => {
  test.skipIf(skip)("un flux sous la borne se décompresse normalement", async () => {
    const text = "EDT de la semaine 42 — cours, devoirs, DS. ".repeat(200);
    const out = await ask({ op: "roundTrip", text });
    expect(out.text).toBe(text);
    expect(out.size).toBe(Buffer.byteLength(text, "utf8"));
  });

  test.skipIf(skip)("un flux EXACTEMENT à la borne passe (pas de refus hors sujet)", async () => {
    const first = await ask({ op: "inflate", size: 1 });
    const max = first.max as number;
    const out = await ask({ op: "inflate", size: max });
    expect(out.ok).toBe(true);
    expect(out.out).toBe(max);
  });

  test.skipIf(skip)("un flux AU-DELÀ de la borne est REFUSÉ, sans OOM", async () => {
    const first = await ask({ op: "inflate", size: 1 });
    const max = first.max as number;
    const out = await ask({ op: "inflate", size: max + 1 });
    // Une erreur BORNÉE (jamais un `OutOfMemoryError` qui tue la JVM).
    expect(out.ok).toBe(false);
    expect(out.error).not.toBe("OutOfMemoryError");
    // Le ciphertext reste minuscule : c'est bien l'EXPANSION qui est refusée.
    expect(out.packed).toBeLessThan(max / 100);
    expect(out.max).toBe(10_485_760);
  });

  test("la borne est UNE constante partagée avec le transport", () => {
    const http = readFileSync(join(PRONOTE, "HttpSession.kt"), "utf8");
    const communication = readFileSync(join(PRONOTE, "Communication.kt"), "utf8");
    expect(http).toContain("internal const val MAX_RESPONSE_BYTES = 10_485_760");
    expect(communication).toContain("MAX_RESPONSE_BYTES");
    expect(communication).toContain("out.size() + n > MAX_RESPONSE_BYTES");
  });
});

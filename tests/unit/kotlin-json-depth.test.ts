// Le parseur JSON du port est BORNÉ en profondeur : sans borne, une réponse
// `[[[[…]]]]` épuise la pile et lève une `Error` NON attrapable (crash).
// La VRAIE source est compilée et pilotée ; outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const JSON_LIB = join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Json.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "JsonDepthMain.kt");

/** Borne du port : 512 conteneurs, ÉCRITE ICI et non lue dans le code (la changer doit casser le test). */
const MAX_DEPTH = 512;

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface ParseResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function parse(text: string): Promise<ParseResult> {
  return JSON.parse(await link!.ask({ op: "parse", text }, { allowError: true })) as ParseResult;
}

/** `n` conteneurs imbriqués : `[[[…]]]`. */
function nested(n: number): string {
  return "[".repeat(n) + "]".repeat(n);
}

describe("borne de profondeur du parseur JSON (#414)", () => {
  test.skipIf(skip)("une entrée profonde échoue par une erreur RATRAPABLE, pas par un StackOverflowError", async () => {
    // 5000 niveaux : le port doit refuser par un `JsonError` (Exception), pas crasher.
    const r = await parse(nested(5000));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("JsonError");
    // Le point de l'issue : jamais une `Error` (non attrapable).
    expect(r.error).not.toBe("StackOverflowError");
    expect(r.message).toMatch(/profondeur/i);
  });

  test.skipIf(skip)("une entrée normale (profondeur 20) est toujours analysée", async () => {
    expect((await parse(nested(20))).ok).toBe(true);
    // Une enveloppe PRONOTE réelle : la borne ne doit rien casser d'ordinaire.
    const enveloppe = '{"data":{"notes":[{"id":1,"note":20}],"absences":[]}}';
    expect((await parse(enveloppe)).ok).toBe(true);
  });

  test.skipIf(skip)("la borne est exacte : 512 passent, 513 sont refusées", async () => {
    expect((await parse(nested(MAX_DEPTH))).ok).toBe(true);
    const over = await parse(nested(MAX_DEPTH + 1));
    expect(over.ok).toBe(false);
    expect(over.error).toBe("JsonError");
  });

  // Pin statique : protège même sans la chaîne Kotlin (SKIP bruyant).
  test("le parseur compare la profondeur courante à une borne (pin statique)", () => {
    const src = readFileSync(JSON_LIB, "utf8");
    expect(src).toMatch(/MAX_DEPTH\s*=\s*\d+/);
    expect(src).toMatch(/depth\s*>=\s*MAX_DEPTH/);
  });
});

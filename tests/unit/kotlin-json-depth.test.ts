// #414 : le parseur JSON du port est BORNÉ en profondeur.
//
// Le `Json` embarqué (`android/pronote/.../Json.kt`) est un parseur
// RÉCURSIF : sans borne, une réponse serveur malformée (`[[[[…]]]]`) épuise
// la pile et lève `StackOverflowError` — une `Error`, donc NON attrapable par
// les `catch (e: Exception)` des dépôts, de `PeriodicSyncWorker` et du pilote
// de parité : l'app CRASHE au lieu d'échouer proprement. `JSON.parse` de V8,
// lui, lève un `RangeError` attrapable.
//
// Ce test ne Miroite pas la logique : il COMPILE la vraie source de production
// (`Json.kt`) et la pilote via `agents/runtime/kotlin-parity/JsonDepthMain.kt`.
// Les assertions portent donc sur le code exécuté.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const JSON_LIB = join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Json.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "JsonDepthMain.kt");

/**
 * La borne choisie par le port : 512 conteneurs imbriqués. Assez large pour
 * n'importe quelle enveloppe PRONOTE (3-4 niveaux), assez étroit pour que la
 * pile ne déborde jamais. Volontairement ÉCRIT ICI et non lu dans le code :
 * changer la borne doit casser ce test (délibéré, jamais silencieux).
 */
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
    // 5000 niveaux : le parseur non borné y épuise la pile (observé : SOE dès
    // ~2000 niveaux sur la JVM du harnais). Le port doit le refuser par un
    // `JsonError` — une `Exception`, donc attrapable par les `catch` de
    // l'app : un ÉCHEC DE LECTURE, pas un crash.
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

  // Pin statique : le filet du comportement est le test Kotlin ci-dessus ;
  // celui-ci protège même quand la chaîne d'outils Kotlin est absente (SKIP
  // bruyant) — et vérifie que la BORNE existe bien dans le parseur.
  test("le parseur compare la profondeur courante à une borne (pin statique)", () => {
    const src = readFileSync(JSON_LIB, "utf8");
    expect(src).toMatch(/MAX_DEPTH\s*=\s*\d+/);
    expect(src).toMatch(/depth\s*>=\s*MAX_DEPTH/);
  });
});

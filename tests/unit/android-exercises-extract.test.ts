// Extraction des exercices : le format réel d'un manuel (titre + sous-questions)
// ne doit pas éclater un énoncé en plusieurs exercices.
//
// Le test compile les sources de production `core/*.kt` (sauf les deux fichiers
// Android) et pilote `Exercises.extract` : aucune copie de la logique.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const SKIP_FILES = new Set(["CapabilitiesJson.kt", "RevisionPdf.kt"]);
const SOURCES = readdirSync(CORE)
  .filter((f) => f.endsWith(".kt") && !SKIP_FILES.has(f))
  .map((f) => join(CORE, f));

const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
const dir = skip ? "" : mkdtempSync(join(tmpdir(), "exercises-extract-"));
if (!skip) {
  const driver = join(dir, "ExercisesDriver.kt");
  writeFileSync(
    driver,
    `package fr.veryslopnynotes.exercises

import fr.veryslopnynotes.core.Exercises
import fr.veryslopnynotes.core.JsonValue
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.core.stringifyJson

private fun JsonValue.Obj.str(key: String): String = (fields[key] as? JsonValue.Str)?.value ?: ""

fun main() {
    val stdin = java.io.BufferedReader(
        java.io.InputStreamReader(System.\`in\`, java.nio.charset.StandardCharsets.UTF_8),
    )
    val stdout = java.io.PrintStream(System.out, true, java.nio.charset.StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        val op = parseJsonValue(line) as JsonValue.Obj
        val items = Exercises.extract(
            text = op.str("text"),
            page = op.str("page").toIntOrNull() ?: 0,
            source = op.str("source").ifEmpty { "Manuel : test" },
        )
        stdout.println(stringifyJson(JsonValue.Arr(items.map { e ->
            JsonValue.Obj(linkedMapOf(
                "number" to JsonValue.Str(e.number),
                "statement" to JsonValue.Str(e.statement),
            ))
        })))
    }
}
`,
  );
  const jar = await parityToolchain.ensureJar("exercises-extract", [...SOURCES, driver], {
    timeoutMs: 180_000,
  });
  link = await parityToolchain.openLink(jar, {
    mainClass: "fr.veryslopnynotes.exercises.ExercisesDriverKt",
  });
}

if (dir) afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function extract(text: string): Promise<Array<{ number: string; statement: string }>> {
  return JSON.parse(await link!.ask({ text, page: "106" })) as Array<{
    number: string;
    statement: string;
  }>;
}

describe("Exercises.extract — format réel du manuel", () => {
  test.skipIf(skip)("un titre absorbe ses sous-questions numérotées", async () => {
    const text = [
      "Exercice 71 — Calculer.",
      "1. Soit n un entier naturel. Déterminer les entiers d tels que d ∣ (n+6) et d ∣ (2n+3).",
      "2. En déduire les couples (n ; d) correspondants.",
      "",
      "Exercice 72 — Chercher.",
      "1. Exprimer la somme S en fonction de n.",
      "2. En déduire que 3^n − 1 est pair.",
    ].join("\n");
    const items = await extract(text);
    expect(items.map((e) => e.number)).toEqual(["71", "72"]);
    expect(items[0]!.statement).toContain("— Calculer.");
    expect(items[0]!.statement).toContain("1. Soit n");
    expect(items[0]!.statement).toContain("2. En déduire");
    expect(items[1]!.statement).toContain("2. En déduire");
  });

  test.skipIf(skip)("des exercices numérotés sans titre restent séparés", async () => {
    const text = [
      "1. Calculer la somme des entiers de 1 à n.",
      "2. Démontrer que cette somme vaut n(n+1)/2.",
    ].join("\n");
    const items = await extract(text);
    expect(items.map((e) => e.number)).toEqual(["1", "2"]);
    expect(items[0]!.statement).not.toContain("2. Démontrer");
  });

  test.skipIf(skip)("sans marqueur, aucun exercice inventé", async () => {
    expect(await extract("Un paragraphe ordinaire sans numéro ni titre.")).toEqual([]);
  });
});

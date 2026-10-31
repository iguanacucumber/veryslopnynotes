// Manuel d'un ouvrage PRÉCIS : sa matière doit correspondre à la demande.
//
// Une adresse de catalogue (`/manuels`) choisit l'ouvrage PAR matière ; une
// adresse d'ouvrage précis, elle, ne dit rien de sa matière. Avant, l'extrait
// gardé partait dans TOUT prompt (un extrait de maths dans un devoir
// d'histoire) et l'interface annonçait le manuel disponible pour chaque
// matière.
//
// `Manuals.kt` lit `SharedPreferences` et OkHttp : impossible de l'exécuter
// hors Gradle. La règle pure `manualMatchesSubject` est donc EXTRAITE du
// fichier de production tel quel et compilée avec `ManualCatalog.kt` (le
// harnais de parité) : les verdicts testés sont ceux du code réel. Le CÂBLAGE
// (extrait ET disponibilité) est vérifié sur le source, comme
// `kotlin-manual-account-purge.test.ts`.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");

const manualSource = readFileSync(join(DATA, "Manuals.kt"), "utf8");
const manual = codeOnly(manualSource);
const settings = codeOnly(readFileSync(join(APP, "VsnBridgeSettings.kt"), "utf8"));
const lessons = codeOnly(readFileSync(join(APP, "VsnBridgeLessons.kt"), "utf8"));

/** Corps d'une fonction/méthode `fun <nom>(`, accolades équilibrées. */
function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

/**
 * SOURCE de la fonction (signature comprise), prise VERBATIM dans
 * `Manuals.kt` : le pilote compile les mêmes octets que l'app, pas une copie.
 * Absente = le test échoue bruyamment (la règle a bougé de place).
 */
function functionSource(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

const PREDICATE = functionSource(manualSource, "fun manualMatchesSubject(");
const MENTIONS = functionSource(manualSource, "internal fun manualMentionsSubject(");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
const dir = skip ? "" : mkdtempSync(join(tmpdir(), "manual-subject-"));
if (!skip) {
  const driver = join(dir, "ManualSubjectDriver.kt");
  writeFileSync(
    driver,
    `package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ManualCatalog
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json

${PREDICATE}
${MENTIONS}

private fun JVal.Obj.str(key: String): String = (fields[key] as? JVal.Str)?.value ?: ""

fun main() {
    val stdin = java.io.BufferedReader(
        java.io.InputStreamReader(System.\`in\`, java.nio.charset.StandardCharsets.UTF_8),
    )
    val stdout = java.io.PrintStream(System.out, true, java.nio.charset.StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        val op = Json.parse(line) as JVal.Obj
        val ok = if (op.str("op") == "mentions") {
            manualMentionsSubject(op.str("doc"), op.str("requested"))
        } else {
            manualMatchesSubject(op.str("doc"), op.str("requested"))
        }
        stdout.println(Json.stringify(JVal.Bool(ok)))
    }
}
`,
  );
  const jar = await parityToolchain.ensureJar("kotlin-manual-subject", [
    join(CORE, "ManualCatalog.kt"),
    join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Json.kt"),
    driver,
  ]);
  link = await parityToolchain.openLink(jar, {
    mainClass: "fr.veryslopnynotes.data.ManualSubjectDriverKt",
  });
}

if (dir) afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function matches(doc: string, requested: string): Promise<boolean> {
  return JSON.parse(await link!.ask({ doc, requested })) as boolean;
}

describe("manuel d'un ouvrage précis — la matière de la fiche décide", () => {
  test("la règle existe et reste pure (java.* + noyau, compilable hors Gradle)", () => {
    expect(PREDICATE.length).toBeGreaterThan(0);
    // Le pilote l'exécute : aucune API Android ni JSON dans la règle.
    expect(PREDICATE).not.toMatch(/android\.|org\.json|okhttp/);
    // UNE règle de matière : celle du catalogue, pas une seconde.
    expect(PREDICATE).toContain("ManualCatalog.subjectKey(");
    expect(manual).not.toContain("Normalizer");
  });

  test.skipIf(skip)("extrait de MATHS + demande d'HISTOIRE : aucun extrait", async () => {
    expect(await matches("Mathématiques", "Histoire-Géographie")).toBe(false);
    expect(await matches("Mathématiques", "HISTOIRE GEOGRAPHIE")).toBe(false);
    expect(await matches("Physique-Chimie", "Mathématiques")).toBe(false);
    expect(await matches("Mathématiques expertes", "Mathématiques")).toBe(false);
  });

  test.skipIf(skip)("extrait de MATHS + demande de MATHS : l'extrait part", async () => {
    expect(await matches("Mathématiques", "Mathématiques")).toBe(true);
    // Libellés Pronote : casse et accents ne séparent pas la même matière.
    expect(await matches("Mathématiques", "MATHS")).toBe(true);
    expect(await matches("Mathématiques", "maths")).toBe(true);
    expect(await matches("Histoire-Géographie", "HISTOIRE GEOGRAPHIE")).toBe(true);
    expect(await matches("Géographie", "Histoire-Géographie")).toBe(true);
    expect(await matches("NSI", "Numérique et sciences informatiques")).toBe(true);
  });

  test.skipIf(skip)("un titre de page neutre est complété par l'en-tête du manuel", async () => {
    // Page réelle : le titre ne dit pas la matière, l'extrait si.
    const page = "1. Relation de divisibilité dans Z | Lelivrescolaire.fr " +
      "Nos manuels Se connecter Menu Sommaire Accueil du manuel Mathématiques Expertes Terminale";
    const verdict = async (doc: string, requested: string): Promise<boolean> =>
      JSON.parse(await link!.ask({ op: "mentions", doc, requested })) as boolean;
    expect(await verdict(page, "Mathématiques expertes")).toBe(true);
    // « Mathématiques » n'est PAS « Mathématiques expertes ».
    expect(await verdict(page, "Mathématiques")).toBe(false);
    expect(await verdict("Histoire-Géographie Terminale", "Mathématiques")).toBe(false);
  });

  test.skipIf(skip)("matière vide ou inconnue : refus (fail-closed)", async () => {
    // Une fiche sans matière ne prouve rien.
    expect(await matches("", "Mathématiques")).toBe(false);
    // Une demande sans matière n'est pas une demande de maths.
    expect(await matches("Mathématiques", "")).toBe(false);
    expect(await matches("", "")).toBe(false);
    // Matière absente de la table : la règle du catalogue (aucun ouvrage
    // plutôt qu'un mauvais) s'applique aussi à l'ouvrage précis.
    expect(await matches("Droit", "Droit")).toBe(false);
  });
});

describe("pont — extrait et disponibilité appliquent la même règle", () => {
  test("manualDocFor : un ouvrage précis hors matière ne produit AUCUNE source", () => {
    const doc = bodyOf(settings, "internal fun VsnBridge.manualDocFor(");
    expect(doc.length).toBeGreaterThan(0);
    // Le catalogue est reconnu une fois, et sa branche de résolution est intacte.
    expect(doc).toContain("val catalog = ManualCatalog.isCatalog(stored)");
    expect(doc).toContain("ManualCatalog.resolve(stored, classLabel, subjects, subject)");
    // Extrait en cache : la fiche entière tranche (sujet, titre, début d'extrait).
    expect(doc).toContain("manualMatchesSubject(doc, subject)");
    expect(doc).not.toContain("manuals.doc(target)?.let { return it }");
    // Extrait fraîchement récolté : même contrôle avant de le rendre.
    const cached = doc.slice(0, doc.indexOf("val now = System.currentTimeMillis()"));
    const fetched = doc.slice(doc.indexOf("val fetched = ManualsClient("));
    for (const part of [cached, fetched]) {
      expect(part).toContain("if (matches(doc)) doc else null");
    }
  });

  test("manualAvailableForSubject : une matière sans extrait ne s'annonce pas servie", () => {
    const available = bodyOf(lessons, "internal fun VsnBridge.manualAvailableForSubject(");
    expect(available.length).toBeGreaterThan(0);
    // Ouvrage précis : la fiche en cache décide…
    expect(available).toContain("val doc = manuals.doc(url) ?: return true");
    expect(available).toContain("manualMatchesSubject(doc, subject)");
    // …et la disponibilité n'est plus vraie pour toutes les matières.
    expect(available).not.toContain("if (!ManualCatalog.isCatalog(url)) return true");
    // Le catalogue garde sa règle de résolution.
    expect(available).toContain("ManualCatalog.resolve(url, classLabel, subjects, subject) != null");
  });
});

// check-kotlin.ts — le défaut PR #114 (`android/core` ne compilait pas : doublon de
// `private fun urlEncode`) doit être visible SANS SDK ni Gradle. On lance le vrai
// script sur des fichiers .kt générés dans un tmpdir : pas de doublon.commité dans
// l'arbre (un .kt cassé dans android/ ou tests/ ferait hurler tout le monde).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "agents/runtime/check-kotlin.ts");

// Cas réel de la PR #114 : deux `private fun urlEncode(value: String): String` dans
// le même `object` = "Conflicting overloads" côté compilateur Kotlin.
const DUP = `package fr.veryslopnynotes.core

object ServerConfig {
    fun mediaUrl(ref: String): String = "/v1/media?ref=" + urlEncode(ref)

    private fun urlEncode(value: String): String {
        return value.replace(" ", "%20")
    }

    private fun urlEncode(value: String): String {
        return value.replace("/", "%2F")
    }
}
`;

// Même fichier, une seule des deux fonctions : doit passer.
const SANE = DUP.replace(
  `    private fun urlEncode(value: String): String {
        return value.replace("/", "%2F")
    }
`,
  "",
);

// Faux positifs interdits : surcharge par type, scopes distincts, fonctions locales,
// propriétés de constructeur, chaînes brutes contenant des accolades.
const NO_FP = `package fr.veryslopnynotes.core

object A {
    fun f(x: String): String = x
    fun f(x: Int): Int = x
    fun f(x: String, y: Int = 0): String = "$x$y"
    companion object {
        fun f(x: String): String = x
    }
}

class B(val id: String, val title: String) {
    fun f(x: String): String = x
}

class C {
    val bloc = """
        { "a": 1, "b": "}" }
        fun fake(x: String): String = x
    """
}

fun scoped(): Int {
    fun f(x: String) = x
    if (true) { fun f(x: String) = x }
    val f = 1
    return f
}
`;

function run(files: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "check-kotlin-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    const p = Bun.spawnSync(["bun", "run", SCRIPT, dir], { cwd: ROOT, stderr: "pipe" });
    return { code: p.exitCode, out: p.stderr.toString() + p.stdout.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check-kotlin", () => {
  test("doublon de signature dans le même scope = FAIL nommé", () => {
    const { code, out } = run({ "ServerConfig.kt": DUP });
    expect(code).toBe(1);
    expect(out).toContain("check-kotlin FAIL");
    expect(out).toContain("urlEncode(String)");
    expect(out).toContain("object ServerConfig");
  });

  test("même fichier sans le doublon = OK (rouge/vert sur la seule différence)", () => {
    expect(run({ "ServerConfig.kt": SANE })).toEqual({ code: 0, out: expect.stringContaining("check-kotlin OK") });
  });

  test("surcharges, scopes distincts, fonctions locales, accolades en chaîne = OK", () => {
    expect(run({ "NoFalsePositive.kt": NO_FP }).code).toBe(0);
  });

  // Régression #204 : `fun interface` n'est pas une fonction. Le script y voyait
  // un `fun` nommé `interface`, sautait aux parenthèses de la méthode SAM et
  // mangeait l'accolade du corps (faux « accolades déséquilibrées » sur du code
  // qui compile — LlmGuard.kt).
  test("fun interface SAM = OK, méthode dedans sans doublon", () => {
    const src = [
      "package p",
      "",
      "fun interface Provider {",
      "    fun generate(system: String, data: List<String>): String",
      "}",
      "",
      "interface Plain : Provider",
      "",
    ].join("\n");
    expect(run({ "Sam.kt": src }).code).toBe(0);
  });

  test("accolades non fermées = FAIL", () => {
    const { code, out } = run({ "Broken.kt": "package p\n\nobject O {\n    fun f(): Int = 1\n" });
    expect(code).toBe(1);
    expect(out).toContain("accolades déséquilibrées");
  });

  test("android/ réel : aucun faux positif sur l'arbre courant", () => {
    const p = Bun.spawnSync(["bun", "run", SCRIPT], { cwd: ROOT, stderr: "pipe" });
    expect({ code: p.exitCode, out: p.stderr.toString() + p.stdout.toString() }).toEqual({
      code: 0,
      out: expect.stringContaining("check-kotlin OK"),
    });
  });
  // Régression : défaut réel rencontré à la compilation (PR #115). Kotlin imbrique
  // les commentaires de bloc : un chemin `/v1/pairing/` suivi d'une étoile, écrit
  // dans un KDoc, ouvre un second commentaire que la fermeture suivante ne referme
  // pas — tout le reste du fichier devient commentaire. Le script le ratait car il
  // traitait les commentaires à la façon de Java.
  test("commentaire de bloc imbriqué jamais refermé = FAIL", () => {
    const src = [
      "package p",
      "",
      "/**",
      " * un 401 sur `/v1/pairing/*` est un appairage refuse",
      " */",
      "object O {",
      "    fun f(): Int = 1",
      "}",
      "",
    ].join("\n");
    const { code, out } = run({ "Nested.kt": src });
    expect(code).toBe(1);
    expect(out).toContain("commentaire de bloc jamais refermé");
  });

  test("commentaire de bloc normalement imbriqué et refermé = OK", () => {
    const src = [
      "package p",
      "",
      "/**",
      " * outer /* inner */ still outer",
      " */",
      "object O {",
      "    fun f(): Int = 1",
      "}",
      "",
    ].join("\n");
    expect(run({ "NestedOk.kt": src }).code).toBe(0);
  });

  // #418 : le bundle Vite est écrit dans `android/app/src/main/assets/web/`
  // PENDANT le build (`check.ts` lance les étapes en parallèle) et le dossier
  // disparaît sous les pieds du parcours. Le parcours ne descend donc plus
  // dans les artefacts GÉNÉRÉS, et une entrée illisible n'abandonne plus le
  // reste du répertoire (avant : le `catch` global perdait `main/java/` en
  // entier, et le script annonçait « OK » sans avoir scanné les .kt de l'app).
  test("un .kt sous les artefacts GÉNÉRÉS (src/main/assets) n'est jamais scanné", () => {
    const { code, out } = run({
      "app/src/main/assets/web/Genere.kt": DUP, // artefact : jamais scanné
      "app/src/main/java/Ok.kt": SANE, // source : scannée, sans doublon
    });
    expect({ code, out }).toEqual({ code: 0, out: expect.stringContaining("check-kotlin OK") });
  });

  test("une entrée disparue n'abandonne pas le reste du répertoire", () => {
    // `assets` est un lien mort : il imite le bundle Vite qui disparaît
    // pendant le build. Le .kt voisin DOIT être scanné (et signalé).
    const dir = mkdtempSync(join(tmpdir(), "check-kotlin-418-"));
    try {
      mkdirSync(join(dir, "app/src/main/java"), { recursive: true });
      symlinkSync(join(dir, "cible-inexistante"), join(dir, "app/src/main/assets"));
      writeFileSync(join(dir, "app/src/main/java/Broken.kt"), DUP);
      const p = Bun.spawnSync(["bun", "run", SCRIPT, dir], { cwd: ROOT, stderr: "pipe" });
      const out = p.stderr.toString() + p.stdout.toString();
      // Avant : le `catch` global abandonnait `main/` → 0 fichier scanné → OK.
      expect(p.exitCode).toBe(1);
      expect(out).toContain("check-kotlin FAIL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // #532 : un scanner sans fichiers à scanner n'a rien vérifié. Avant, un
  // répertoire absent rendait « check-kotlin OK (0 fichiers) » : le garde-fou
  // devenait vacuously vrai, et chaque étape du gate annonçait « OK » sans
  // avoir lu une ligne de Kotlin.
  test("un répertoire ABSENT = ÉCHEC bruyant, pas « OK (0 fichiers) »", () => {
    const dir = join(tmpdir(), "check-kotlin-absent-xyz");
    const p = Bun.spawnSync(["bun", "run", SCRIPT, dir], { cwd: ROOT, stderr: "pipe" });
    const out = p.stderr.toString() + p.stdout.toString();
    expect(p.exitCode).toBe(1);
    expect(out).toContain("check-kotlin FAIL");
    expect(out).toContain("aucun fichier .kt/.kts");
    expect(out).toContain("ABSENT");
    // Jamais le faux vert.
    expect(out).not.toContain("check-kotlin OK");
  });

  test("un répertoire VIDE = ÉCHEC bruyant, pas « OK (0 fichiers) »", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-kotlin-vide-"));
    try {
      const p = Bun.spawnSync(["bun", "run", SCRIPT, dir], { cwd: ROOT, stderr: "pipe" });
      const out = p.stderr.toString() + p.stdout.toString();
      expect(p.exitCode).toBe(1);
      expect(out).toContain("check-kotlin FAIL");
      expect(out).toContain("aucun fichier .kt/.kts");
      expect(out).not.toContain("check-kotlin OK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

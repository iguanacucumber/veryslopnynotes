// check-kotlin.ts — le défaut PR #114 (`android/core` ne compilait pas : doublon de
// `private fun urlEncode`) doit être visible SANS SDK ni Gradle. On lance le vrai
// script sur des fichiers .kt générés dans un tmpdir : pas de doublon.commité dans
// l'arbre (un .kt cassé dans android/ ou tests/ ferait hurler tout le monde).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      writeFileSync(join(dir, name), content);
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
});

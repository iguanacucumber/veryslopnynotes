import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// agents/runtime/android-env.sh — la découverte JDK/SDK que Makefile, android-compile,
// buildDebugApk et buildRelApk partagent. Une erreur ici = soit un `make check` qui
// saute en silence, soit un JDK 25 qui fait échouer Gradle avec un message illisible.

const SCRIPT = join(import.meta.dir, "..", "..", "agents/runtime/android-env.sh");

/** Faux JDK dans `~/.cache/jdk17` (le chemin de repli réel). */
function fakeHomeJdk(major: number): string {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const dir = join(home, ".cache", "jdk17");
  mkdirSync(join(dir, "bin"), { recursive: true });
  const java = join(dir, "bin", "java");
  writeFileSync(java, `#!/bin/sh\necho 'openjdk version "${major}.0.1" 2026-08-18' >&2\n`);
  chmodSync(java, 0o755);
  return home;
}

/** Faux JDK : `bin/java -version` qui annonce la version voulue. */
function fakeJdk(major: number | null): string {
  const dir = mkdtempSync(join(tmpdir(), "jdk-"));
  mkdirSync(join(dir, "bin"));
  if (major !== null) {
    const java = join(dir, "bin", "java");
    writeFileSync(java, `#!/bin/sh\necho 'openjdk version "${major}.0.1" 2026-08-18' >&2\n`);
    chmodSync(java, 0o755);
  }
  return dir;
}

function detect(env: Record<string, string>): { jdk: string; sdk: string; exit: number } {
  const proc = Bun.spawnSync(["sh", "-c", `. ${SCRIPT}; printf '%s|%s' "$(android_jdk)" "$(android_sdk)"`], {
    env: { ...env, PATH: process.env["PATH"] ?? "" },
  });
  const out = new TextDecoder().decode(proc.stdout);
  const [jdk = "", sdk = ""] = out.split("|");
  return { jdk, sdk, exit: proc.exitCode };
}

describe("android-env.sh", () => {
  test("JDK : accepte 17-21, refuse 25 (Gradle 8.7 le refuse) et le JDK absent", () => {
    const jdk17 = fakeJdk(17);
    const jdk21 = fakeJdk(21);
    const jdk25 = fakeJdk(25);
    const noJava = fakeJdk(null);
    const clean = { ANDROID_JDK_HOME: "", JAVA_HOME: "", HOME: "/nonexistent-home" };

    expect(detect({ ...clean, ANDROID_JDK_HOME: jdk17 }).jdk).toBe(jdk17);
    expect(detect({ ...clean, ANDROID_JDK_HOME: jdk21 }).jdk).toBe(jdk21);
    // Le piège : un JDK 25 installé et valide est REJETÉ (échec Gradle opaque sinon).
    expect(detect({ ...clean, ANDROID_JDK_HOME: jdk25 }).jdk).toBe("");
    expect(detect({ ...clean, ANDROID_JDK_HOME: noJava }).jdk).toBe("");
    // ANDROID_JDK_HOME gagne sur JAVA_HOME quand les deux conviennent.
    expect(detect({ ...clean, ANDROID_JDK_HOME: jdk17, JAVA_HOME: jdk21 }).jdk).toBe(jdk17);
    // Un JAVA_HOME trop récent ne fait pas ignorer un JDK correct plus bas (~/.cache/jdk17).
    const home = fakeHomeJdk(17);
    expect(detect({ ...clean, JAVA_HOME: jdk25, HOME: home }).jdk).toBe(join(home, ".cache", "jdk17"));
  });

  test("SDK : ANDROID_HOME d'abord, sinon sdk.dir du local.properties", () => {
    const sdkA = mkdtempSync(join(tmpdir(), "sdk-a-"));
    const sdkB = mkdtempSync(join(tmpdir(), "sdk-b-"));
    // ANDROID_PROJECT_DIR = le dossier du projet Android (celui qui contient local.properties).
    const project = mkdtempSync(join(tmpdir(), "proj-"));
    writeFileSync(join(project, "local.properties"), `sdk.dir=${sdkB}\n`);

    expect(detect({ ANDROID_HOME: sdkA, ANDROID_SDK_ROOT: sdkB, ANDROID_PROJECT_DIR: project }).sdk).toBe(sdkA);
    // Repli sur local.properties quand rien n'est dans l'environnement.
    expect(detect({ ANDROID_HOME: "", ANDROID_SDK_ROOT: "", ANDROID_PROJECT_DIR: project }).sdk).toBe(sdkB);
    // Un chemin mort dans local.properties ne vaut pas mieux que pas de SDK du tout.
    writeFileSync(join(project, "local.properties"), "sdk.dir=/nonexistent-sdk\n");
    expect(detect({ ANDROID_HOME: "", ANDROID_SDK_ROOT: "", ANDROID_PROJECT_DIR: project }).sdk).toBe("");
    // Rien du tout = chaîne vide ET code 0 : le skip du gate ne doit pas casser make.
    expect(detect({ ANDROID_HOME: "", ANDROID_SDK_ROOT: "", ANDROID_PROJECT_DIR: "/nonexistent" }).exit).toBe(0);
  });

  test("le script ne fait rien tant qu'on ne l'appelle pas (pas d'effet de bord)", () => {
    const proc = Bun.spawnSync(["sh", "-c", `. ${SCRIPT}`], { env: { PATH: process.env["PATH"] ?? "" } });
    expect(proc.exitCode).toBe(0);
    expect(new TextDecoder().decode(proc.stdout)).toBe("");
  });

  test("le hint d'installation cite les deux prérequis (JDK borné + SDK 34)", () => {
    const proc = Bun.spawnSync(["sh", "-c", `. ${SCRIPT}; android_toolchain_hint`], {
      env: { PATH: process.env["PATH"] ?? "" },
    });
    const hint = new TextDecoder().decode(proc.stdout);
    expect(hint).toMatch(/17-21/);
    expect(hint).toMatch(/platforms;android-34/);
    expect(hint).toMatch(/build-tools;34\.0\.0/);
  });

  test("les cibles Gradle partagent la découverte, sans la réécrire", () => {
    const makefile = readFileSync(join(import.meta.dir, "..", "..", "Makefile"), "utf8");
    // `shot` (#133) construit l'APK debug pour la capture : même découverte.
    for (const target of ["android-compile:", "buildDebugApk:", "buildRelApk:", "shot:"]) {
      expect(makefile).toContain(target);
    }
    // Une seule découverte : personne ne réinvente la boucle de version.
    expect(makefile.match(/android_jdk/g)?.length).toBe(4);
    expect(makefile).not.toMatch(/android-check/);
  });
});

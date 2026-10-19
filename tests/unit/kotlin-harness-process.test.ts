// Les PROCESSUS du harnais de parité Kotlin : c'est là que les fuites
// vivaient. Trois défauts réels, trois preuves.
//
//   1. ORPHELIN. `kotlinc` est un script bash qui lance `java` comme ENFANT.
//      Tuer le script seul laissait le `java` compiler à 100 % CPU EN
//      ARRIÈRE-PLAN : c'est exactement ce que l'on voyait dans `ps`.
//   2. BLOCAGE. `Bun.spawnSync` bloquait le worker : un compilateur coincé
//      figeait le test jusqu'à la fin des temps, sans plafond de durée.
//   3. SATURATION. `bun test --parallel` lance un worker par fichier et il y a
//      une douzaine de fichiers de parité : autant de JVM `kotlinc` d'un coup,
//      la machine à 100 % CPU.
//
// Le harnais est testé AVEC des FAUX binaires (`KOTLINC_BIN`, `KOTLIN_JAVA_BIN`) :
// pas de JVM réelle, pas de cache pollué, comportement déterministe. Les faux
// reproduisent la structure du vrai (un script qui lance un ENFANT et ne rend
// pas la main) — c'est ce petit-fils qu'il ne faut pas laisser derrière soi.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killGroup, parityToolchain, ROOT } from "./fixtures/kotlin-harness";

/** Un pid existe-t-il encore ? */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // vivant, pas à nous
  }
}

function ps(args: string[]): string {
  const r = Bun.spawnSync(["ps", ...args], { stdout: "pipe", stderr: "pipe" });
  return r.stdout.toString();
}

/** Pids des enfants directs du processus courant. */
function childPids(): number[] {
  return ps(["-o", "pid=", "--ppid", String(process.pid)])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(Number);
}

/** Enfants directs du processus courant restés en ZOMBIE (jamais récoltés). */
function zombiePids(): number[] {
  return childPids().filter((pid) => ps(["-o", "stat=", "-p", String(pid)]).trim().startsWith("Z"));
}

/** Faux compilateur : journalise son début/fin et produit un jar vide.
 *  Le journal et le jar sortent des variables d'environnement (le harnais
 *  passe les sources en arguments, pas le journal). */
const STUB_OK = `#!/usr/bin/env bash
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-d" ]; then out="$a"; fi
  prev="$a"
done
echo "S" >> "$KOTLIN_STUB_LOG"
sleep 0.2
: > "$out"
echo "F" >> "$KOTLIN_STUB_LOG"
`;

/** Faux compilateur BLOQUÉ : il lance un enfant (comme le vrai `kotlinc`
 *  lance `java`) et ne rend jamais la main. */
const STUB_BLOCKING = `#!/usr/bin/env bash
sleep 300 &
echo $! > "$KOTLIN_STUB_PIDFILE"
wait
`;

/** Faux compilateur qui ÉCHOUE (comme une erreur de compilation Kotlin). */
const STUB_FAILING = `#!/usr/bin/env bash
echo "erreur: source cassée" >&2
exit 1
`;

/** Faux `java` : il note son pid et ne rend jamais la main (un pilote qui
 *  traîne). */
const STUB_JAVA = `#!/usr/bin/env bash
echo $$ > "$KOTLIN_STUB_PIDFILE"
sleep 300
`;

function writeStub(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

/** Variable d'environnement restaurée à la fin du test. */
function env(key: string, value: string | undefined): () => void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

/** Vide le cache d'un harnais : le cache est indexé par le CONTENU des
 *  sources, donc un run précédent aurait servi un jar déjà compilé et le
 *  test n'aurait rien compilé du tout. */
function clearCache(name: string): void {
  rmSync(join(ROOT, "node_modules", ".cache", name), { recursive: true, force: true });
}

describe("harnais de parité Kotlin : gestion des processus", () => {
  test("killGroup tue le petit-fils, pas seulement le script", async () => {
    // Reproduit la structure réelle : un script (`kotlinc`) qui lance un
    // enfant (`java`). Tuer le script seul laisserait l'enfant orphelin.
    // (`& wait` : sans lui, bash EXÉCUTE `sleep` et n'a aucun enfant.)
    const proc = Bun.spawn(["bash", "-c", "sleep 300 & wait"], {
      detached: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    await Bun.sleep(400);
    const kids = ps(["-o", "pid=", "--ppid", String(proc.pid)])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map(Number);
    expect(kids.length).toBeGreaterThan(0);
    const child = kids[0]!;
    expect(alive(child)).toBe(true);

    killGroup(proc.pid);
    await Bun.sleep(400);
    // LE petit-fils doit être mort : pas de compilateur orphelin à 100 % CPU.
    expect(alive(child)).toBe(false);
    expect(alive(proc.pid)).toBe(false);
  });

  test("compilateur bloqué : tué au plafond, sans survivant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kotlin-harness-"));
    const stub = writeStub(dir, "fake-kotlinc", STUB_BLOCKING);
    const pidFile = join(dir, "child.pid");
    const src = join(dir, "A.kt");
    writeFileSync(src, "package p\nfun f(): Int = 1\n");

    const restoreBin = env("KOTLINC_BIN", stub);
    const restorePid = env("KOTLIN_STUB_PIDFILE", pidFile);
    // Sémaphore isolé : sinon ce test attend le slot des compiles RÉELLES
    // qui tournent en parallèle et dépasse le timeout du runner.
    const restoreSlots = env("KOTLIN_COMPILE_SLOTS_DIR", join(dir, "slots"));
    let child = 0;
    clearCache("kotlin-harness-proc");
    try {
      await expect(
        parityToolchain.ensureJar("kotlin-harness-proc", [src], { timeoutMs: 1500 }),
      ).rejects.toThrow(/dépassé/);
      child = Number(readFileSync(pidFile, "utf8").trim());
    } finally {
      restoreBin();
      restorePid();
      restoreSlots();
    }
    expect(Number.isInteger(child)).toBe(true);
    expect(child).toBeGreaterThan(0);
    // Le « java » du faux compilateur : mort avec son groupe. (Le SIGKILL est
    // asynchrone : on attend la mort, on ne la suppose pas immédiate.)
    for (let i = 0; i < 60 && alive(child); i++) await Bun.sleep(50);
    expect(alive(child)).toBe(false);
    // Aucun jar (même partiel) ne doit rester dans le cache.
    rmSync(join(ROOT, "node_modules", ".cache", "kotlin-harness-proc"), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  test("compilation en échec : bruitée, et aucun jar (même partiel) laissé", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kotlin-harness-"));
    const stub = writeStub(dir, "fake-kotlinc", STUB_FAILING);
    const src = join(dir, "A.kt");
    writeFileSync(src, "package p\nfun f(): Int = 1\n");

    const restoreBin = env("KOTLINC_BIN", stub);
    const restoreSlots = env("KOTLIN_COMPILE_SLOTS_DIR", join(dir, "slots"));
    clearCache("kotlin-harness-fail");
    try {
      await expect(
        parityToolchain.ensureJar("kotlin-harness-fail", [src], { timeoutMs: 20_000 }),
      ).rejects.toThrow(/ne compile pas/);
    } finally {
      restoreBin();
      restoreSlots();
    }
    const cache = join(ROOT, "node_modules", ".cache", "kotlin-harness-fail");
    const leftovers = Bun.spawnSync(["find", cache, "-name", "*.jar*"], { stdout: "pipe" }).stdout.toString().trim();
    expect(leftovers).toBe("");
    rmSync(cache, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  test("sémaphore : deux compilations ne se chevauchent pas au-delà du plafond", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kotlin-harness-"));
    const log = join(dir, "log");
    writeFileSync(log, "");
    const stub = writeStub(dir, "fake-kotlinc", STUB_OK);
    const srcA = join(dir, "A.kt");
    const srcB = join(dir, "B.kt");
    writeFileSync(srcA, "package p\nfun a(): Int = 1\n");
    writeFileSync(srcB, "package p\nfun b(): Int = 2\n");

    const restoreBin = env("KOTLINC_BIN", stub);
    const restoreJobs = env("KOTLIN_COMPILE_JOBS", "1"); // un seul slot
    const restoreSlots = env("KOTLIN_COMPILE_SLOTS_DIR", join(dir, "slots")); // sémaphore isolé
    const restoreLog = env("KOTLIN_STUB_LOG", log);
    clearCache("kotlin-harness-sem-a");
    clearCache("kotlin-harness-sem-b");
    try {
      await Promise.all([
        parityToolchain.ensureJar("kotlin-harness-sem-a", [srcA], { timeoutMs: 20_000 }),
        parityToolchain.ensureJar("kotlin-harness-sem-b", [srcB], { timeoutMs: 20_000 }),
      ]);
    } finally {
      restoreBin();
      restoreJobs();
      restoreSlots();
      restoreLog();
    }
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
    // Sémaphore à 1 slot : jamais deux « S » (démarrages) d'affilée.
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.some((l, i) => l === "S" && lines[i + 1] === "S")).toBe(false);

    for (const name of ["kotlin-harness-sem-a", "kotlin-harness-sem-b"]) {
      rmSync(join(ROOT, "node_modules", ".cache", name), { recursive: true, force: true });
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("le pilote java est arrêté et récolté : ni vivant ni zombie", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kotlin-harness-"));
    const stub = writeStub(dir, "fake-java", STUB_JAVA);
    const pidFile = join(dir, "java.pid");

    const restoreJava = env("KOTLIN_JAVA_BIN", stub);
    const restorePid = env("KOTLIN_STUB_PIDFILE", pidFile);
    try {
      const link = await parityToolchain.openLink(join(dir, "peu-importe.jar"));
      // Le faux `java` tourne : il ne rend jamais la main tout seul.
      for (let i = 0; i < 50 && !existsSync(pidFile); i++) await Bun.sleep(50);
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      expect(pid).toBeGreaterThan(0);
      expect(alive(pid)).toBe(true);

      link.close();
      for (let i = 0; i < 50 && alive(pid); i++) await Bun.sleep(50);
      // Arrêté…
      expect(alive(pid)).toBe(false);
      // … ET récolté (pas de `[java] <defunct>` empilé dans `ps`).
      expect(zombiePids()).toEqual([]);
    } finally {
      restoreJava();
      restorePid();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

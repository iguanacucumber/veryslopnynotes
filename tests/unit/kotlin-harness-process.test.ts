// Les processus du harnais de parité Kotlin : aucun orphelin (le `java` enfant
// de kotlinc), aucun blocage sans plafond, aucun excès de JVM concurrentes.
// Testé avec des FAUX binaires : pas de JVM réelle, comportement déterministe.
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

/** Attend que l'état réel devienne vrai : `timeoutMs` est un plafond, pas une attente. */
async function until(
  cond: () => boolean | Promise<boolean>,
  timeoutMs: number,
  stepMs = 10,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > deadline) return false;
    await Bun.sleep(stepMs);
  }
}

/** Faux compilateur : journalise début/fin, produit un jar vide ; le `sleep` rend un chevauchement visible. */
const STUB_OK = `#!/usr/bin/env bash
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-d" ]; then out="$a"; fi
  prev="$a"
done
echo "S" >> "$KOTLIN_STUB_LOG"
sleep 0.05
: > "$out"
echo "F" >> "$KOTLIN_STUB_LOG"
`;

/** Faux compilateur BLOQUÉ : lance un enfant comme le vrai kotlinc, sans rendre la main. */
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

/** Faux `java` : note son pid et ne rend jamais la main. */
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

/** Vide le cache : il est indexé par le CONTENU des sources. */
function clearCache(name: string): void {
  rmSync(join(ROOT, "node_modules", ".cache", name), { recursive: true, force: true });
}

describe("harnais de parité Kotlin : gestion des processus", () => {
  test("killGroup tue le petit-fils, pas seulement le script", async () => {
    // Un script (kotlinc) qui lance un enfant (java) : tuer le script seul laisse l'orphelin.
    // (`& wait` : sans lui, bash exécute `sleep` et n'a aucun enfant.)
    const proc = Bun.spawn(["bash", "-c", "sleep 300 & wait"], {
      detached: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    // On attend l'ÉTAT (l'enfant existe), pas une durée fixe.
    const born = await until(
      () => ps(["-o", "pid=", "--ppid", String(proc.pid)]).trim().length > 0,
      10_000,
    );
    expect(born).toBe(true);
    const kids = ps(["-o", "pid=", "--ppid", String(proc.pid)])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map(Number);
    expect(kids.length).toBeGreaterThan(0);
    const child = kids[0]!;
    expect(alive(child)).toBe(true);

    killGroup(proc.pid);
    // La mort est OBSERVÉE, pas supposée après un délai.
    const dead = await until(() => !alive(child) && !alive(proc.pid), 10_000);
    expect(dead).toBe(true);
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
    // Sémaphore isolé : sinon ce test attend le slot des compiles réelles en parallèle.
    const restoreSlots = env("KOTLIN_COMPILE_SLOTS_DIR", join(dir, "slots"));
    let child = 0;
    clearCache("kotlin-harness-proc");
    try {
      // Plafond court : le faux compilateur ne rend jamais la main.
      await expect(
        parityToolchain.ensureJar("kotlin-harness-proc", [src], { timeoutMs: 400 }),
      ).rejects.toThrow(/dépassé/);
      // Le faux compilateur a lancé son enfant : on attend le PID RÉEL.
      const written = await until(() => existsSync(pidFile), 10_000);
      expect(written).toBe(true);
      child = Number(readFileSync(pidFile, "utf8").trim());
    } finally {
      restoreBin();
      restorePid();
      restoreSlots();
    }
    expect(Number.isInteger(child)).toBe(true);
    expect(child).toBeGreaterThan(0);
    // Mort avec son groupe ; le SIGKILL est asynchrone, donc on attend la mort.
    const dead = await until(() => !alive(child), 10_000);
    expect(dead).toBe(true);
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
      // On attend que son PID soit ÉCRIT, pas qu'un délai s'écoule.
      const written = await until(() => existsSync(pidFile), 10_000);
      expect(written).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      expect(pid).toBeGreaterThan(0);
      expect(alive(pid)).toBe(true);

      link.close();
      // Arrêté…
      const dead = await until(() => !alive(pid), 10_000);
      expect(dead).toBe(true);
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

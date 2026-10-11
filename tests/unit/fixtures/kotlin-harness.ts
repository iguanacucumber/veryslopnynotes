// Harnais partagé de la parité TS <-> Kotlin (#202).
//
// Compile des sources Kotlin pour de vrai (`kotlinc -include-runtime`, binaire
// en cache `node_modules/.cache/<nom>/<sha256>/`) puis pilote le binaire en
// JSON ligne à ligne (une opération par ligne sur stdin, une réponse par ligne
// sur stdout). La comparaison se fait sur du canonique (clés triées) côté test.
//
// Chaîne requise : `kotlinc` + `java`. Absente = `SKIP_REASON` renseigné + SKIP
// BRUYANT (jamais un faux vert, même philosophie que `make android-compile`).
// En revanche un ÉCHEC DE COMPILATION est un défaut : `ensureJar` lève (le code
// commité doit compiler).
import { afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..", "..");

export interface ParityLink {
  /**
   * Une opération JSON → une ligne de réponse. Par défaut une ligne
   * `{"error":…}` lève (entrée malformée, défaut pilote) ; `allowError` la
   * renvoie telle quelle quand l'erreur du PORT est le résultat attendu
   * (parité des refus : nom + message comparés).
   */
  ask(op: unknown, opts?: { allowError?: boolean }): Promise<string>;
  close(): void;
}

export interface ParityToolchain {
  readonly skipReason: string | null;
  ensureJar(cacheName: string, sources: string[]): Promise<string>;
  openLink(jar: string): Promise<ParityLink>;
}

function toolchain(): ParityToolchain {
  const kotlinc = Bun.which("kotlinc");
  const java = Bun.which("java");
  const skipReason =
    !kotlinc
      ? "`kotlinc` absent : installez le compilateur Kotlin (ou lancez `make android-compile` pour le diagnostic)."
      : !java
        ? "`java` absent : la parité a besoin d'une JVM pour exécuter le port compilé."
        : null;
  if (skipReason) {
    console.warn(
      "\n" +
        "  SKIP BRUYANT — parité TS <-> Kotlin non vérifiée.\n" +
        `  ${skipReason}\n` +
        "  `make check` reste vert, mais il n'a PAS prouvé que le port calcule comme la référence.\n",
    );
  }

  /** sha256 du CONTENU des sources (une modification = nouveau cache). */
  function fileDigest(sources: string[]): string {
    const h = createHash("sha256");
    for (const f of sources) h.update(readFileSync(f));
    return h.digest("hex").slice(0, 16);
  }

  async function ensureJar(cacheName: string, sources: string[]): Promise<string> {
    const dir = join(ROOT, "node_modules", ".cache", cacheName, fileDigest(sources));
    const jar = join(dir, "parity.jar");
    if (existsSync(jar)) return jar;
    mkdirSync(dir, { recursive: true });
    const compiled = Bun.spawnSync({
      cmd: [kotlinc as string, ...sources, "-include-runtime", "-d", jar],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (compiled.exitCode !== 0) {
      throw new Error(`le port Kotlin ne compile pas (défaut, pas un skip) :\n${compiled.stderr}\n${compiled.stdout}`);
    }
    return jar;
  }

  async function openLink(jar: string): Promise<ParityLink> {
    const proc = Bun.spawn([java as string, "-Dfile.encoding=UTF-8", "-jar", jar], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const sink = proc.stdin;
    const reader = proc.stdout.getReader();
    let pending = "";
    const decoder = new TextDecoder("utf-8");
    async function readLine(): Promise<string> {
      for (;;) {
        const nl = pending.indexOf("\n");
        if (nl >= 0) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          return line;
        }
        const { done, value } = await reader.read();
        if (done) throw new Error("le pilote Kotlin a fermé stdout au milieu d'une opération");
        pending += decoder.decode(value, { stream: true });
      }
    }
    // Drain stderr : une erreur pilote y est expliquée (jamais un résultat vide).
    const errors: string[] = [];
    (async () => {
      const errReader = proc.stderr.getReader();
      let buf = "";
      for (;;) {
        const { done, value } = await errReader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) errors.push(l.trim());
      }
    })();
    afterAll(() => proc.kill());
    return {
      async ask(op: unknown, opts?: { allowError?: boolean }): Promise<string> {
        sink.write(`${JSON.stringify(op)}\n`);
        await sink.flush();
        const line = await Promise.race([
          readLine(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pilote Kotlin sans réponse (30 s)")), 30000)),
        ]);
        if (line.startsWith('{"error":') && !opts?.allowError) {
          throw new Error(`erreur pilote (entrée malformée ?) : ${line} — stderr: ${errors.join(" | ")}`);
        }
        if (line.startsWith('{"error":')) {
          const parsed = JSON.parse(line) as { message?: string };
          if (typeof parsed.message === "string" && parsed.message.startsWith("pilote: ")) {
            throw new Error(`erreur pilote : ${line} — stderr: ${errors.join(" | ")}`);
          }
        }
        return line;
      },
      close() {
        proc.kill();
      },
    };
  }

  return { skipReason, ensureJar, openLink };
}

export const parityToolchain: ParityToolchain = toolchain();

/** Même forme que les pilotes : clés triées, `undefined` = clé omise. */
export function canonTs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonTs).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonTs(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

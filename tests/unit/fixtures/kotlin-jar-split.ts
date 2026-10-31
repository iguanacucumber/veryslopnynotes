// Découpe le jar d'union (production + pilotes) en deux jars.
//
// L'attribution d'une classe à son fichier source se lit dans l'attribut
// `SourceFile` du bytecode, pas dans le nom de la classe : un pilote peut
// déclarer des classes imbriquées, des lambdas et des `object` dont le nom ne
// dit rien du fichier. Le compilateur écrit cet attribut pour chaque classe.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const utf8 = new TextDecoder();

/** Lit un attribut `SourceFile` d'un `.class`, ou null si absent/malformé. */
export function sourceFileOf(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const u1 = (): number => view.getUint8(o++);
  const u2 = (): number => {
    const v = view.getUint16(o);
    o += 2;
    return v;
  };
  const u4 = (): number => {
    const v = view.getUint32(o);
    o += 4;
    return v;
  };
  try {
    if (u4() !== 0xcafebabe) return null;
    o += 4; // minor + major
    const count = u2();
    const strings: Array<string | undefined> = [];
    for (let i = 1; i < count; i++) {
      const tag = u1();
      switch (tag) {
        case 1: {
          const len = u2();
          strings[i] = utf8.decode(bytes.subarray(o, o + len));
          o += len;
          break;
        }
        case 3:
        case 4:
          o += 4;
          break;
        case 5:
        case 6:
          o += 8;
          i++; // long/double prennent deux entrées
          break;
        case 7:
        case 8:
        case 16:
        case 19:
        case 20:
          o += 2;
          break;
        case 9:
        case 10:
        case 11:
        case 12:
        case 17:
        case 18:
          o += 4;
          break;
        case 15:
          o += 3;
          break;
        default:
          return null;
      }
    }
    o += 6; // access_flags, this_class, super_class
    const interfaces = u2();
    o += interfaces * 2;
    for (let members = 0; members < 2; members++) {
      const n = u2();
      for (let i = 0; i < n; i++) {
        o += 6; // access, name, descriptor
        const attrs = u2();
        for (let a = 0; a < attrs; a++) {
          o += 2;
          const len = u4();
          o += len;
        }
      }
    }
    const attrs = u2();
    for (let a = 0; a < attrs; a++) {
      const name = strings[u2()];
      const len = u4();
      if (name === "SourceFile") return strings[u2()] ?? null;
      o += len;
    }
    return null;
  } catch {
    return null;
  }
}

function jar(args: string[], cwd?: string): void {
  const proc = Bun.spawnSync(["jar", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`« jar ${args.join(" ")} » a échoué : ${proc.stderr.toString().trim()}`);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function move(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

/**
 * Éclate `unionJar` en `portJar` (production + runtime Kotlin) et `driversJar`.
 *
 * Les fichiers non `.class` (manifest, métadonnées Kotlin, stdlib) restent
 * dans le port. `driverNames` contient les NOMS DE FICHIERS (`X.kt`), uniques
 * dans le dépôt — vérifié par `kotlin-parity-union.test.ts`.
 */
export function splitParityJar(
  unionJar: string,
  portJar: string,
  driversJar: string,
  driverNames: ReadonlySet<string>,
): void {
  const work = mkdtempSync(join(tmpdir(), "parity-split-"));
  const extracted = join(work, "union");
  const portDir = join(work, "port");
  const driversDir = join(work, "drivers");
  mkdirSync(extracted, { recursive: true });
  mkdirSync(portDir, { recursive: true });
  mkdirSync(driversDir, { recursive: true });
  try {
    jar(["xf", unionJar], extracted);
    for (const file of walk(extracted)) {
      const rel = relative(extracted, file);
      let target = join(portDir, rel);
      if (rel.endsWith(".class")) {
        const source = sourceFileOf(readFileSync(file));
        if (source !== null && driverNames.has(source)) target = join(driversDir, rel);
      }
      move(file, target);
    }
    jar(["cf", portJar, "-C", portDir, "."]);
    jar(["cf", driversJar, "-C", driversDir, "."]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

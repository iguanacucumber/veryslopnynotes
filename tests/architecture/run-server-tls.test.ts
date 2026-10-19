import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #421 — `make runServer` ne doit JAMAIS démarrer en clair.
//
// Le bug : la recette enchainait la preparation TLS avec des POINT-VIRGULES
// (`. … ; dev_tls ; bun run …`). Si le script etait deplace (appel depuis un
// autre repertoire) ou si la preparation echouait, le serveur demarrait quand
// meme — sans TLS_CERT_FILE/TLS_KEY_FILE, donc en HTTP (le serveur retombe
// sur HTTP quand les variables TLS sont absentes), sur 0.0.0.0. Un service
// sans authentification (I8) qui repond « succes » en clair : le pire des
// deux mondes.
//
// Deux angles, parce que l'un seul ne prouve rien :
//   - statique  : la recette enchaine bien avec `&&` (jamais de `;`) ;
//   -Comportemental : la recette EXECUTEE s'arrete sur un echec de
//     preparation et ne lance JAMAIS le serveur (un faux `bun` pose dans le
//     PATH ecrit un marqueur s'il est appele).

const ROOT = join(import.meta.dir, "..", "..");
const MAKEFILE = join(ROOT, "Makefile");

/** Lignes de recette (tabulation) de la cible demandee. */
function recipeOf(target: string): string {
  const lines = readFileSync(MAKEFILE, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${target}:`));
  if (start < 0) throw new Error(`cible absente du Makefile : ${target}`);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    if (!line.startsWith("\t")) break;
    out.push(line);
  }
  return out.join("\n");
}

/** La commande que make executerait, telle qu'il l'ecrit (`$$` -> `$`). */
function expandedRecipe(): string {
  const dry = Bun.spawnSync(["make", "--no-print-directory", "-n", "runServer"], { cwd: ROOT });
  expect(dry.exitCode).toBe(0);
  return new TextDecoder().decode(dry.stdout).trim();
}

interface Run {
  code: number;
  out: string;
}

/** Execute la recette dans un repertoire et un environnement donnes. */
function runRecipe(cwd: string, env: Record<string, string>): Run {
  const proc = Bun.spawnSync(["/bin/sh", "-c", expandedRecipe()], { cwd, env });
  const dec = new TextDecoder();
  return { code: proc.exitCode ?? -1, out: dec.decode(proc.stdout) + dec.decode(proc.stderr) };
}

/**
 * Faux `bun` dans un PATH isole : s'il est appele, il ecrit un marqueur.
 * Aucun vrai serveur n'est donc lance, meme si la recette demarre. Le PATH
 * contient les outils habituels du script de preparation, mais PAS openssl.
 */
function fakeBin(tmp: string): { bin: string; marker: string } {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  for (const tool of ["cat", "mkdir", "chmod", "sed", "head", "ip", "ls", "make"]) {
    for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      const src = join(dir, tool);
      if (!existsSync(src)) continue;
      try {
        symlinkSync(src, join(bin, tool));
      } catch {
        /* deja lie : on garde le premier */
      }
      break;
    }
  }
  const marker = join(tmp, "launched");
  const bun = join(bin, "bun");
  // Le marqueur porte ce que le serveur aurait recus : les valeurs doivent
  // arriver telles quelles, sans substitution par l'auto-signe.
  writeFileSync(
    bun,
    `#!/bin/sh
printf 'launched PORT=%s HOST=%s CERT=%s KEY=%s\n' "$PORT" "$HOST" "$TLS_CERT_FILE" "$TLS_KEY_FILE" > "${marker}"
`,
  );
  chmodSync(bun, 0o755);
  return { bin, marker };
}

describe("make runServer (#421)", () => {
  test("la recette enchaine la preparation TLS avec && (jamais de point-virgule)", () => {
    const recipe = recipeOf("runServer");
    // Point-virgule = « on continue meme si la preparation a echoue » : c'est
    // precisement le trou du bug (le serveur démarrait en clair, sans bruit).
    expect(recipe).not.toContain(";");
    expect(recipe).toContain(". agents/runtime/dev-tls.sh && dev_tls &&");
  });

  test("PORT/HOST restent surchargeables et HOST ne se bind pas sur toutes les interfaces", () => {
    const recipe = recipeOf("runServer");
    expect(recipe).toMatch(/PORT="\$\$\{PORT:-/);
    expect(recipe).toMatch(/HOST="\$\$\{HOST:-/);
    // I8 : le scraper est sans auth, donc pas d'ecoute universelle par defaut.
    expect(recipe).toMatch(/HOST="\$\$\{HOST:-127\.0\.0\.1\}"/);
    expect(recipe).not.toContain("0.0.0.0");
  });

  test("un echec de preparation TLS ARRETE le lancement (le serveur ne demarre pas)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "runsrv-"));
    const { bin, marker } = fakeBin(tmp);
    // PATH sans openssl : la preparation echoue -> la chaine `&&` s'arrete.
    const run = runRecipe(ROOT, { PATH: bin, HOME: tmp, DEV_TLS_DIR: join(tmp, "tls") });
    expect(run.code).not.toBe(0);
    expect(run.out).toMatch(/openssl/);
    // Le faux `bun` n'a pas ete appele : aucun serveur lance, donc aucun
    // service sans auth en clair sur 0.0.0.0.
    expect(existsSync(marker)).toBe(false);
    // Et aucun certificat n'a ete cree sur un echec.
    expect(existsSync(join(tmp, "tls"))).toBe(false);
  });

  test("le script de preparation introuvable ARRETE aussi le lancement", () => {
    const tmp = mkdtempSync(join(tmpdir(), "runsrv-"));
    const { bin, marker } = fakeBin(tmp);
    // Hors du depot : `agents/runtime/dev-tls.sh` n'existe pas -> la
    // preparation echoue, le serveur ne doit pas demarrer pour autant.
    const run = runRecipe(tmp, { PATH: bin, HOME: tmp, DEV_TLS_DIR: join(tmp, "tls") });
    expect(run.code).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  test("une preparation qui echoue SANS arreter le shell n'ouvre pas la porte au clair", () => {
    // Le cas que le `;` laissait passer : une preparation qui rend un code
    // non nul sans tuer le shell (un `return 1`, un `false`...). Avec `&&`,
    // la chaine s'arrete la ; avec `;`, le serveur demarrait en clair.
    const tmp = mkdtempSync(join(tmpdir(), "runsrv-"));
    const { bin, marker } = fakeBin(tmp);
    const stub = join(tmp, "agents", "runtime");
    mkdirSync(stub, { recursive: true });
    writeFileSync(join(stub, "dev-tls.sh"), "dev_tls() { return 1; }\n");

    const run = runRecipe(tmp, { PATH: bin, HOME: tmp, DEV_TLS_DIR: join(tmp, "tls") });
    expect(run.code).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  test("de bout en bout : PORT/HOST surcharges et couple TLS fourni arrivent au serveur", () => {
    // La vraie cible `make runServer`, avec un faux `bun` qui note ce qu'il
    // recoit. Preuve que la chaine `&&` laisse passer les valeurs ET que le
    // couple fourni est servi TEL QUEL (pas d'auto-signe, pas d'openssl).
    const tmp = mkdtempSync(join(tmpdir(), "runsrv-e2e-"));
    const { bin, marker } = fakeBin(tmp);
    const cert = join(tmp, "mon-cert.pem");
    const key = join(tmp, "ma-cle.pem");
    writeFileSync(cert, "certificat factice\n");
    writeFileSync(key, "cle factice\n");

    const p = Bun.spawnSync(["make", "--no-print-directory", "runServer"], {
      cwd: ROOT,
      env: {
        PATH: bin,
        HOME: tmp,
        DEV_TLS_DIR: join(tmp, "tls"),
        PORT: "9090",
        HOST: "0.0.0.0",
        TLS_CERT_FILE: cert,
        TLS_KEY_FILE: key,
      },
    });
    expect(p.exitCode).toBe(0);
    const note = readFileSync(marker, "utf8");
    expect(note).toContain("PORT=9090");
    expect(note).toContain("HOST=0.0.0.0");
    // Le couple fourni est celui qui part vers le serveur.
    expect(note).toContain(`CERT=${cert}`);
    expect(note).toContain(`KEY=${key}`);
    // Et rien n'a ete genere (le cache TLS n'existe pas).
    expect(existsSync(join(tmp, "tls"))).toBe(false);
  });
});

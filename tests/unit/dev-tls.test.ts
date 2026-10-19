import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// agents/runtime/dev-tls.sh — le script qui fournit le certificat de
// `make runServer`.
//
// #421 : avant, `dev_tls` ÉCRASSAIT TLS_CERT_FILE/TLS_KEY_FILE avec son
// auto-signé, même quand l'opérateur avait fourni son propre couple
// (makcert, Let's Encrypt) — et il exigeait openssl AVANT de regarder les
// certificats fournis. Conséquence : le téléphone refusait le certificat
// servi (« Trust anchor not found ») et l'opérateur dépanne le téléphone.
//
// Contrat attendu :
//   - couple fourni  -> respecté TEL QUEL, aucun certificat créé, openssl inutile ;
//   - couple incomplet ou illisible -> échec BRUYANT (jamais de repli silencieux,
//     jamais de clairtext) ;
//   - aucun couple, pas d'openssl -> échec bruyant (le lanceur s'arrete, cf.
//     tests/architecture/run-server-tls.test.ts).

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "agents/runtime/dev-tls.sh");

interface Run {
  code: number;
  out: string;
}

/**
 * Source le script puis appelle `dev_tls`, dans un environnement donne.
 * PATH isole (vide) : `openssl` est absent -> on prouve que le couple fourni
 * n'en a pas besoin.
 */
function devTls(env: Record<string, string>): Run {
  const proc = Bun.spawnSync(
    [
      "/bin/sh",
      "-c",
      `. ${SCRIPT}; dev_tls; printf 'CERT=%s\\nKEY=%s\\n' "$TLS_CERT_FILE" "$TLS_KEY_FILE"; env | grep '^TLS_' | sort`,
    ],
    { env },
  );
  const dec = new TextDecoder();
  return { code: proc.exitCode ?? -1, out: dec.decode(proc.stdout) + dec.decode(proc.stderr) };
}

/**
 * PATH isolé : les outils habituels du script, mais PAS openssl (on prouve
 * qu'un couple fourni n'en a pas besoin). Des liens, pas des copies.
 */
function sandboxBin(tmp: string): string {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  for (const tool of ["cat", "mkdir", "chmod", "sed", "head", "ip", "ls", "env", "grep", "sort"]) {
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
  return bin;
}

/** Environnement de base : PATH sans openssl, HOME et cache jetables. */
function baseEnv(tmp: string): Record<string, string> {
  return { PATH: sandboxBin(tmp), HOME: tmp, DEV_TLS_DIR: join(tmp, "tls") };
}

describe("dev_tls (#421)", () => {
  test("un couple fourni est respecte tel quel : aucun certificat cree, openssl inutile", () => {
    const tmp = mkdtempSync(join(tmpdir(), "devtls-"));
    const cert = join(tmp, "mon-cert.pem");
    const key = join(tmp, "ma-cle.pem");
    writeFileSync(cert, "certificat factice\n");
    writeFileSync(key, "cle factice\n");
    const env = { ...baseEnv(tmp), TLS_CERT_FILE: cert, TLS_KEY_FILE: key };

    const run = devTls(env);
    expect(run.code).toBe(0);
    // Les chemins fournis sont ceux qui partent vers le serveur : ni
    // réécriture, ni substitution par l'auto-signé.
    expect(run.out).toContain(`CERT=${cert}`);
    expect(run.out).toContain(`KEY=${key}`);
    // Et ils sont EXPORTÉS : c'est ce que le serveur lit (I8), pas une
    // variable locale perdue au retour de la fonction.
    expect(run.out).toContain(`TLS_CERT_FILE=${cert}`);
    expect(run.out).toContain(`TLS_KEY_FILE=${key}`);
    // Aucun certificat généré, pas même le répertoire de cache.
    expect(existsSync(join(tmp, "tls"))).toBe(false);
  });

  test("un couple incomplet est refuse bruyamment (aucun repli auto-signe)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "devtls-"));
    const cert = join(tmp, "mon-cert.pem");
    writeFileSync(cert, "certificat factice\n");
    const run = devTls({ ...baseEnv(tmp), TLS_CERT_FILE: cert });
    expect(run.code).not.toBe(0);
    expect(run.out).toMatch(/ensemble/);
    expect(existsSync(join(tmp, "tls"))).toBe(false);
  });

  test("un couple fourni mais illisible est refuse bruyamment", () => {
    const tmp = mkdtempSync(join(tmpdir(), "devtls-"));
    const key = join(tmp, "ma-cle.pem");
    writeFileSync(key, "cle factice\n");
    const run = devTls({
      ...baseEnv(tmp),
      TLS_CERT_FILE: join(tmp, "absent.pem"),
      TLS_KEY_FILE: key,
    });
    expect(run.code).not.toBe(0);
    expect(existsSync(join(tmp, "tls"))).toBe(false);
  });

  test("sans couple et sans openssl, l'echec est bruyant (pas de clairtext silencieux)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "devtls-"));
    const run = devTls(baseEnv(tmp));
    expect(run.code).not.toBe(0);
    expect(run.out).toMatch(/openssl/);
    expect(existsSync(join(tmp, "tls"))).toBe(false);
  });
});

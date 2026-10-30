// #396 : un message d'exception brut peut nommer l'hôte de l'établissement.
//
// L'appairage traverse la frontière native/JS : le pont ne transmet que le
// CODE d'échec et rend une phrase bornée CHOISIE PAR LUI
// (`android/app/.../PairingMessages.kt`). Le message brut de la couche `data`
// (une `IOException` peut dire « Failed to connect to <hôte>:<port> ») ne
// franchit plus cette frontière (I10, ADR-004).
//
// Ce test ne Miroite pas la logique : il COMPILE la VRAIE source de
// production et la pilote via `agents/runtime/kotlin-parity/PairingMessagesParityMain.kt`.
// Les assertions portent donc sur du code exécuté.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const MESSAGES = join(APP, "PairingMessages.kt");
const REPO = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data", "PairingRepository.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PairingMessagesParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

/** Phrase rendue par le VRAI Kotlin pour un code d'échec. */
async function message(code: string): Promise<string> {
  const res = JSON.parse(await link!.ask({ op: "message", code })) as { message: string };
  return res.message;
}

/** Codes d'échec que la couche `data` produit vraiment (lus dans sa source). */
function dataCodes(): string[] {
  const src = readFileSync(REPO, "utf8");
  const codes = [...src.matchAll(/PairingResult\.Err\("([a-z_]+)"/g)].map((m) => m[1]!);
  return [...new Set(codes)].sort();
}

// Hôte et message FACTICES (`.test` est réservé, cf. RFC 2606) : ils servent
// seulement à prouver qu'un texte d'hôte ne ressort pas du pont.
const FAKE_HOST = "etab.exemple.test";
const RAW_EXCEPTION = `Failed to connect to ${FAKE_HOST}:8080`;

// Formes d'infra qui ne doivent JAMAIS sortir du pont.
const IPV4 = /(?:\d{1,3}\.){3}\d{1,3}/;
const PORT = /:\d{2,5}\b/;
const URL = /:\/\//;
const DOMAIN = /\b[a-z0-9][a-z0-9-]*\.[a-z]{2,}\b/i;
const ACCOUNT = /@/;

describe("message d'appairage borné (#396)", () => {
  test.skipIf(skip)("chaque code d'échec a une phrase bornée, sans hôte ni IP", async () => {
    const codes = dataCodes();
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const m = await message(code);
      expect({ code, vide: m.trim() === "" }).toEqual({ code, vide: false });
      expect(m.length).toBeLessThanOrEqual(200);
      expect(m).not.toMatch(/[\n\r]/);
      expect({ code, ip: IPV4.test(m) }).toEqual({ code, ip: false });
      expect({ code, port: PORT.test(m) }).toEqual({ code, port: false });
      expect({ code, url: URL.test(m) }).toEqual({ code, url: false });
      expect({ code, domain: DOMAIN.test(m) }).toEqual({ code, domain: false });
      expect({ code, compte: ACCOUNT.test(m) }).toEqual({ code, compte: false });
      // Le texte brut d'une exception ne peut pas être là.
      expect(m).not.toContain(RAW_EXCEPTION);
      expect(m).not.toContain(FAKE_HOST);
    }
  });

  test.skipIf(skip)("un échec d'appairage réseau renvoie un message sans hôte ni IP", async () => {
    const m = await message("network");
    expect(m).toContain("Réseau");
    expect({ ip: IPV4.test(m), port: PORT.test(m), url: URL.test(m) }).toEqual({
      ip: false,
      port: false,
      url: false,
    });
    expect(m).not.toContain(FAKE_HOST);
    expect(m).not.toContain(RAW_EXCEPTION);
  });

  test.skipIf(skip)("chaque code produit par la couche data est connu du pont", async () => {
    // Un code oublié tomberait sur le repli générique : le test le voit.
    const repli = await message("__code_inconnu__");
    expect(repli.length).toBeGreaterThan(0);
    const table = readFileSync(MESSAGES, "utf8");
    for (const code of dataCodes()) {
      expect({ code, message: await message(code) === repli }).toEqual({ code, message: false });
      expect(table).toContain(`"${code}" to "`);
    }
  });

  test("la couche data n'embarque plus le message d'une exception", () => {
    const repo = readFileSync(REPO, "utf8");
    // `IOException` : le message brut nomme l'hôte de l'établissement.
    expect(repo).not.toMatch(/PairingResult\.Err\("network",\s*e\.message/);
    expect(repo).toContain('PairingResult.Err("network", "');
  });

  test("le pont ne transmet que le code de l'échec", () => {
    const bridge = readBridgeSource();
    const debut = bridge.indexOf("private fun pair(");
    expect(debut).toBeGreaterThan(-1);
    const corps = bridge.slice(debut, bridge.indexOf("private fun cancelPairing(", debut));
    expect(corps).toContain("pairingFailureMessage(result.code)");
    expect(corps).not.toContain("result.message");
  });
});

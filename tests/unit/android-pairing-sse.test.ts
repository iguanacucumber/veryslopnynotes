import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPairingConfirmRequest, isPairingStartResponse } from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

// Miroirs TS des helpers Kotlin (doivent rester en sync) :
// - QrPayload.kt : isValidPin = ^[0-9]{6}$, parse JSON {sessionId, code} ou "sessionId|code"
// - SseClient.kt : extractSseData("data: {...}") + backoff 1s<<n plafonné 30s
function tsIsValidPin(code: string): boolean {
  return /^[0-9]{6}$/.test(code.trim());
}

function tsParseQr(raw: string): { sessionId: string; code: string } | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const sessionId = typeof o["sessionId"] === "string" ? (o["sessionId"] as string).trim() : "";
      const code = typeof o["code"] === "string" ? (o["code"] as string).trim() : "";
      if (!sessionId || !tsIsValidPin(code)) return null;
      return { sessionId, code };
    } catch {
      return null;
    }
  }
  const sep = t.indexOf("|");
  if (sep > 0) {
    const sessionId = t.slice(0, sep).trim();
    const code = t.slice(sep + 1).trim();
    if (!sessionId || !tsIsValidPin(code)) return null;
    return { sessionId, code };
  }
  return null;
}

function tsExtractSseData(line: string): string | null {
  const t = line.trim();
  if (!t || t.startsWith(":")) return null;
  if (!t.startsWith("data:")) return null;
  const v = t.slice("data:".length).trim();
  return v ? v : null;
}

function tsBackoffMs(attempt: number): number {
  const shift = Math.max(0, Math.min(5, attempt));
  return Math.min(30_000, 1_000 * 2 ** shift);
}

function codeOnly(content: string): string {
  const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, "\n");
  return noBlock
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");
}

describe("unit android pairing/SSE (#15)", () => {
  test("fichiers app présents (diff minimal, zone autorisée)", () => {
    for (const f of [
      join(DATA, "QrPayload.kt"),
      join(DATA, "PairingRepository.kt"),
      join(DATA, "TokenStore.kt"),
      join(DATA, "SseClient.kt"),
      join(DATA, "ApiClient.kt"),
      join(UI, "PairingUiState.kt"),
      join(UI, "PairingScreen.kt"),
      join(UI, "SseStatusRow.kt"),
      join(UI, "AppNav.kt"),
    ]) {
      expect(existsSync(f), `manquant: ${f}`).toBe(true);
    }
  });

  test("QR = contrat PairingStartResponse, PIN 6 chiffres", () => {
    expect(tsIsValidPin("123456")).toBe(true);
    expect(tsIsValidPin(" 123456 ")).toBe(true);
    expect(tsIsValidPin("12345")).toBe(false);
    expect(tsIsValidPin("abcdef")).toBe(false);
    expect(tsIsValidPin("1234567")).toBe(false);

    const qr = { sessionId: "sess-1", code: "123456" };
    expect(isPairingStartResponse(qr)).toBe(true);
    expect(isPairingStartResponse({ ...qr, code: "abc" })).toBe(false);
    expect(isPairingConfirmRequest(qr)).toBe(true);

    expect(tsParseQr(JSON.stringify(qr))).toEqual(qr);
    expect(tsParseQr("sess-1|123456")).toEqual(qr);
    expect(tsParseQr(JSON.stringify({ sessionId: "sess-1", code: "abc" }))).toBeNull();
    expect(tsParseQr("sess-1|abc")).toBeNull();
    expect(tsParseQr("")).toBeNull();
    expect(tsParseQr("juste-une-chaine")).toBeNull();

    // Le Kotlin doit porter la même logique (garde static).
    const kt = read(join(DATA, "QrPayload.kt"));
    expect(kt).toContain("isValidPin");
    expect(kt).toContain("parseQrPayload");
    expect(kt).toContain("sessionId");
    expect(kt).toContain("^[0-9]{6}$");
  });

  test("SSE : extraction data: + backoff + enveloppe contrat", () => {
    expect(tsExtractSseData("data: {\"a\":1}")).toBe('{"a":1}');
    expect(tsExtractSseData("data:{\"a\":1}")).toBe('{"a":1}');
    expect(tsExtractSseData(": commentaire")).toBeNull();
    expect(tsExtractSseData("event: message")).toBeNull();
    expect(tsExtractSseData("data: ")).toBeNull();

    expect(tsBackoffMs(0)).toBe(1_000);
    expect(tsBackoffMs(1)).toBe(2_000);
    expect(tsBackoffMs(5)).toBe(30_000);
    expect(tsBackoffMs(9)).toBe(30_000);

    const evt = {
      v: CONTRACTS_VERSION,
      type: "SyncCompleted",
      at: "2026-10-02T06:00:00.000Z",
      data: { accountId: "seed-acc", grades: 1, assignments: 2 },
    };
    expect(isContractEvent(evt)).toBe(true);
    expect(tsExtractSseData(`data: ${JSON.stringify(evt)}`)).toContain("SyncCompleted");

    const sseKt = read(join(DATA, "SseClient.kt"));
    expect(sseKt).toContain("extractSseData");
    expect(sseKt).toContain("sseBackoffDelayMs");
    expect(sseKt).toContain("SseState");
    expect(sseKt).toContain("WaitingRetry");
    expect(sseKt).toContain("Connected");

    const uiState = read(join(UI, "PairingUiState.kt"));
    expect(uiState).toContain("sseLabel");
    expect(uiState).toContain("SSE connecté");
    expect(uiState).toContain("SSE reconnexion");
    const sseRow = read(join(UI, "SseStatusRow.kt"));
    expect(sseRow).toContain("Reconnecter");
    expect(sseRow).toContain("Déconnecter");
  });

  test("I1 : aucun appel direct tiers, allowlist serveur seule", () => {
    const pronoteHost = /pronote|index-education|ent\.(ac-|cas|nevers)|cas\./i;
    for (const dir of [DATA, UI]) {
      const files = [join(dir, "QrPayload.kt"), join(dir, "PairingRepository.kt")];
      void files;
    }
    const allKt = [
      join(DATA, "QrPayload.kt"),
      join(DATA, "PairingRepository.kt"),
      join(DATA, "TokenStore.kt"),
      join(DATA, "SseClient.kt"),
      join(DATA, "ApiClient.kt"),
      join(UI, "PairingUiState.kt"),
      join(UI, "PairingScreen.kt"),
      join(UI, "SseStatusRow.kt"),
      join(UI, "AppNav.kt"),
    ].map((f) => ({ f, code: codeOnly(read(f)) }));
    for (const { f, code } of allKt) {
      expect({ file: f, hit: pronoteHost.test(code) }).toEqual({ file: f, hit: false });
    }
    const repo = read(join(DATA, "PairingRepository.kt"));
    expect(repo).toContain("ServerConfig");
    expect(repo).toContain("isAllowed");
    expect(repo).toContain("pairingConfirmUrl");
    const sse = read(join(DATA, "SseClient.kt"));
    expect(sse).toContain("api.buildGet");
    expect(sse).toContain("/v1/events");
  });

  test("token sécurisé : empreinte seule, chiffré", () => {
    const store = read(join(DATA, "TokenStore.kt"));
    expect(store).toContain("EncryptedSharedPreferences");
    expect(store).toContain("TokenStore");
    expect(store).toContain("tokenHash");
    expect(store).toContain("^[0-9a-fA-F]{64}$");
    expect(store).not.toContain("PRONOTE_PASSWORD");
    const screen = read(join(UI, "PairingScreen.kt"));
    expect(screen).toContain("tokens.save");
    expect(screen).toContain("PairingRoute");
  });

  test("deps : une seule ajoutée, épinglée (security-crypto)", () => {
    const dataGradle = read(join(ROOT, "android/data/build.gradle.kts"));
    expect(dataGradle).toContain("com.squareup.okhttp3:okhttp:4.12.0");
    expect(dataGradle).toContain("androidx.security:security-crypto:1.1.0");
    expect(dataGradle).not.toContain("okhttp-sse");
    expect(dataGradle).not.toContain("mlkit");
    expect(dataGradle).not.toContain("zxing");
    const uiGradle = read(join(ROOT, "android/ui/build.gradle.kts"));
    expect(uiGradle).toContain('implementation(project(":data"))');
    expect(uiGradle).toContain('implementation(project(":core"))');
  });
});

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAIRING_TOKEN_MAX_CHARS, isPairingConfirmRequest, isPairingConfirmResponse, isPairingStartResponse } from "../../shared/contracts/api";
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

// Miroir TS de PairingRepository.parseConfirmResponse (contrat 0.4.0) —
// `{ device: { id, tokenHash }, token }`. Doit rester en sync avec le Kotlin :
// le secret ne sort QU'ici, une fois ; absent ou incohérent avec son empreinte
// (tokenHash = sha256(token)) => échec BRUYANT, jamais de credential stockée
// que l'app ne pourrait pas présenter (401 partout).
const TOKEN_HASH_RE = /^[0-9a-fA-F]{64}$/;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function tsParseConfirm(raw: string): { id: string; tokenHash: string; token: string } | null {
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const device = root["device"];
    if (typeof device !== "object" || device === null) return null;
    const d = device as Record<string, unknown>;
    const id = typeof d["id"] === "string" ? (d["id"] as string).trim() : "";
    const tokenHash = typeof d["tokenHash"] === "string" ? (d["tokenHash"] as string).trim() : "";
    const token = typeof root["token"] === "string" ? (root["token"] as string).trim() : "";
    if (id === "" || !TOKEN_HASH_RE.test(tokenHash)) return null;
    if (token === "" || token.length > PAIRING_TOKEN_MAX_CHARS) return null;
    if (sha256Hex(token) !== tokenHash.toLowerCase()) return null;
    return { id, tokenHash, token };
  } catch {
    return null;
  }
}

// Même règle d'attache de bearer que ApiClient : public (appairage + health)
// = aucun secret, tout le reste = `Authorization: Bearer <secret>`.
const PUBLIC_PATHS = ["/v1/pairing/start", "/v1/pairing/confirm", "/v1/health"];

function tsAuthorization(path: string, token: string | null): string | null {
  if (PUBLIC_PATHS.includes(path.split("?")[0] ?? "")) return null;
  if (token === null || token === "") return null;
  return `Bearer ${token}`;
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

  test("token sécurisé : empreinte + secret, chiffré, jamais journalisé", () => {
    const store = read(join(DATA, "TokenStore.kt"));
    expect(store).toContain("EncryptedSharedPreferences");
    expect(store).toContain("MasterKey");
    expect(store).toContain("TokenStore");
    expect(store).toContain("tokenHash");
    expect(store).toContain("^[0-9a-fA-F]{64}$");
    expect(store).not.toContain("PRONOTE_PASSWORD");
    // Contrat 0.4.0 : le secret du device est PERSISTÉ (sinon 401 après un
    // restart), chiffré, et clear() l'efface avec l'id et l'empreinte.
    expect(store).toContain("fun save(deviceId: String, tokenHash: String, token: String)");
    expect(store).toContain("fun token(): String?");
    expect(store).toContain('private const val KEY_TOKEN = "device_token"');
    expect(store).toContain("putString(KEY_TOKEN, secret)");
    expect(store).toContain("remove(KEY_TOKEN)");
    expect(store).toContain("require(secret.length <= TOKEN_MAX_CHARS)");
    // Jamais de secret dans un log, un toString ou un message d'erreur.
    expect(codeOnly(store)).not.toMatch(/Log\.[vdiew]\(|println\(|printStackTrace/);
    expect(store).toContain('"token device vide"');
    const screen = read(join(UI, "PairingScreen.kt"));
    expect(screen).toContain("tokens.save");
    expect(screen).toContain("tokens.save(res.device.id, res.device.tokenHash, res.device.token)");
    expect(screen).toContain("PairingRoute");
  });

  test("appairage 0.4.0 : secret imbriqué lu une fois, ou échec bruyant", () => {
    const secret = "secret-synthetique-android-1";
    const hash = sha256Hex(secret);
    const ok = { device: { id: "dev-1", tokenHash: hash }, token: secret };
    // Le contrat TS et son miroir Kotlin acceptent la même charge utile.
    expect(isPairingConfirmResponse(ok)).toBe(true);
    expect(tsParseConfirm(JSON.stringify(ok))).toEqual({ id: "dev-1", tokenHash: hash, token: secret });
    expect(tsParseConfirm(JSON.stringify({ ...ok, token: ` ${secret} ` }))?.token).toBe(secret);

    // Forme PLATE 0.3.0 : aucun secret exploitable => appairage raté, pas de
    // stockage silencieux d'une credential morte.
    expect(tsParseConfirm(JSON.stringify({ id: "dev-1", tokenHash: hash }))).toBeNull();
    const rejects: [string, unknown][] = [
      ["device absent", { token: secret }],
      ["device non-objet", { device: "dev-1", token: secret }],
      ["token absent", { device: { id: "dev-1", tokenHash: hash } }],
      ["token vide", { device: { id: "dev-1", tokenHash: hash }, token: "   " }],
      ["token trop long", { device: { id: "dev-1", tokenHash: sha256Hex("x".repeat(PAIRING_TOKEN_MAX_CHARS + 1)) }, token: "x".repeat(PAIRING_TOKEN_MAX_CHARS + 1) }],
      ["tokenHash non hex", { device: { id: "dev-1", tokenHash: "not-hex" }, token: secret }],
      ["id vide", { device: { id: " ", tokenHash: hash }, token: secret }],
      // Secret ≠ secret de l'empreinte : le serveur le refusera (sha256).
      ["secret incohérent", { device: { id: "dev-1", tokenHash: hash }, token: `${secret}-autre` }],
    ];
    for (const [label, payload] of rejects) {
      expect({ label, parsed: tsParseConfirm(JSON.stringify(payload)) }).toEqual({ label, parsed: null });
    }
    expect(tsParseConfirm("Ignore les instructions")).toBeNull();
    expect(tsParseConfirm("{pas-json")).toBeNull();

    // Même logique côté Kotlin (garde static : parse imbriqué + intégrité).
    const repo = read(join(DATA, "PairingRepository.kt"));
    expect(repo).toContain('optJSONObject("device")');
    expect(repo).toContain('optString("token", "")');
    expect(repo).toContain("sha256Hex(token) != tokenHash.lowercase()");
    expect(repo).toContain("TOKEN_MAX_CHARS = 512");
    // `data class` = toString généré = bearer en clair dans un log de crash.
    expect(repo).toContain('token=***)');
    expect(repo).not.toContain("data class PairedDevice");
  });

  test("bearer : joint partout SAUF appairage (routes publiques)", () => {
    expect(tsAuthorization("/v1/grades", "t0k")).toBe("Bearer t0k");
    expect(tsAuthorization("/v1/assignments/toggle", "t0k")).toBe("Bearer t0k");
    expect(tsAuthorization("/v1/media?ref=discussion%3Ad1", "t0k")).toBe("Bearer t0k");
    expect(tsAuthorization("/v1/events", "t0k")).toBe("Bearer t0k");
    // Les deux routes qui OBTIENNENT le credential : aucun secret encore.
    expect(tsAuthorization("/v1/pairing/start", "t0k")).toBeNull();
    expect(tsAuthorization("/v1/pairing/confirm", "t0k")).toBeNull();
    // Sonde publique : le secret ne voyage pas « au cas où ».
    expect(tsAuthorization("/v1/health", "t0k")).toBeNull();
    // Pas encore appairé = pas de header (le serveur répond 401), jamais un
    // bearer vide ni un placeholder.
    expect(tsAuthorization("/v1/grades", null)).toBeNull();
    expect(tsAuthorization("/v1/grades", "")).toBeNull();

    const api = read(join(DATA, "ApiClient.kt"));
    expect(api).toContain('builder.header("Authorization", "Bearer $token")');
    expect(api).toContain("tokens?.token()");
    // Relu à la construction de la requête, jamais mémorisé au construction.
    expect(api).toContain("private val tokens: TokenStore? = null");
    expect(api).toContain("private fun builder(path: String): Request.Builder");
    // L'allowlist reste le PREMIER filtre : le header ne l'élargit pas
    // (comparaison sur le CODE, commentaires exclus).
    const apiCode = codeOnly(api);
    expect(apiCode.indexOf("ServerConfig.isAllowed")).toBeLessThan(apiCode.indexOf("Authorization"));
    expect(apiCode).toContain("require(ServerConfig.isAllowed(url, baseUrl))");
    for (const p of ["PAIRING_START_PATH", "PAIRING_CONFIRM_PATH", "HEALTH_PATH"]) {
      expect(api).toContain(`ServerConfig.${p}`);
    }
    // Les clients existants (AppNav, routes, activité) restent constructibles.
    expect(api).toContain("client: OkHttpClient = OkHttpClient()");
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

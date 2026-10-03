// #113 : récupération d'un 401 côté Android (jeton d'appareil révoqué/expiré).
// Le build Gradle n'est pas exécuté ici : on Miroite la logique Kotlin en TS
// ET on garde statiquement le câblage (technique de android-pairing-sse.test.ts).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHEABLE_RESOURCES } from "../../shared/contracts/cache";
import { apiError } from "../../server/api/errors";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const SERVER_API = join(ROOT, "server/api");

function read(p: string): string {
  return readFileSync(p, "utf8");
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

const kt = {
  api: join(DATA, "ApiClient.kt"),
  sse: join(DATA, "SseClient.kt"),
  synced: join(DATA, "SyncedRepository.kt"),
  tokens: join(DATA, "TokenStore.kt"),
  accounts: join(DATA, "AccountStore.kt"),
  nav: join(UI, "AppNav.kt"),
  pairing: join(UI, "PairingScreen.kt"),
};

const HTTP_UNAUTHORIZED = 401;
const MAX_ATTEMPTS_BEFORE_FAILED = 20;
// Miroir de ApiClient.PUBLIC_PATHS (= ServerConfig).
const PUBLIC_PATHS = ["/v1/pairing/start", "/v1/pairing/confirm", "/v1/health"];
// Miroir de DeviceAuth.REJECTED_MESSAGE (lu plus bas dans le Kotlin).
const REJECTED_MESSAGE = "Credential d'appareil refusée : ré-appairez l'appareil.";

// Miroir de ApiClient.UnauthorizedGuard.intercept : un 401 n'invalide la session
// que si la requête PARTAIT avec un bearer sur une route protégée.
function tsIsSessionRejection(code: number, path: string, bearerSent: boolean): boolean {
  if (code !== HTTP_UNAUTHORIZED) return false;
  if (PUBLIC_PATHS.includes(path.split("?")[0] ?? "")) return false;
  return bearerSent;
}

/**
 * App + garde-fou en miniature : l'app n'a QU'un traitement du signal
 * (AppNav : accounts.logout() puis navigation), et `token = null` après le
 * logout est exactement ce qui empêche la boucle (plus aucun bearer au vol).
 */
class TsAppOn401 {
  token: string | null = "secret-synthetique-android-1";
  raises = 0;
  logouts = 0;
  purged: string[] = [];
  navigations: string[] = [];
  notice: string | null = null;
  route = "grades";
  readonly states: string[] = ["grades"];

  constructor() {
    // DeviceAuth.setOnRejected { … } (AppNav) : réparation + navigation.
    DeviceAuthMirror.onRejected = () => {
      this.raises += 1;
      this.notice = REJECTED_MESSAGE;
      this.logouts += 1; // accounts.logout()
      this.purged.push(...CACHEABLE_RESOURCES); // cacheStore.clearAll()
      this.token = null; // tokenStore.clear()
      if (this.route !== "pairing") {
        this.route = "pairing";
        this.states.push("pairing");
        this.navigations.push("pairing");
      }
    };
  }

  /** Une réponse qui traverse l'intercepteur (bearer relu à la construction). */
  reply(code: number, path: string): void {
    const bearerSent = !PUBLIC_PATHS.includes(path.split("?")[0] ?? "") && this.token !== null;
    if (tsIsSessionRejection(code, path, bearerSent)) DeviceAuthMirror.reject();
  }
}

const DeviceAuthMirror = {
  onRejected: null as null | (() => void),
  reject(): void {
    this.onRejected?.();
  },
};

// Miroir de SseClient.onResponse/scheduleRetry. `stopOn401` = le garde-fou #113 ;
// à false, c'est le comportement d'avant (reconnexion sur TOUT non-2xx).
function tsSseRun(statuses: number[], stopOn401: boolean): { connects: number; failed: boolean } {
  let closed = false;
  let attempt = 0;
  let connects = 0;
  let failed = false;
  for (const code of statuses) {
    if (closed) break;
    connects += 1;
    if (code >= 200 && code < 300) {
      attempt = 0;
      continue;
    }
    if (stopOn401 && code === HTTP_UNAUTHORIZED) {
      closed = true;
      failed = true;
      break;
    }
    attempt += 1; // scheduleRetry (backoff 1s, 2s, 4s… plafonné 30s)
    if (attempt > MAX_ATTEMPTS_BEFORE_FAILED) failed = true;
  }
  return { connects, failed };
}

describe("unit android 401 : session perdue -> appairage (#113)", () => {
  test("réalité serveur : un refus = un 401 unique, sans cause révélée", () => {
    // requireDevice (server/api/router.ts) : inconnu / révoqué / expiré partagent
    // le MÊME statut et le MÊME message. Donc l'app NE PEUT PAS distinguer
    // révocation et expiration, et ne doit rien afficher qui l'affirme.
    const refus = apiError("unauthorized", "jeton d'appareil invalide");
    expect(refus.status).toBe(HTTP_UNAUTHORIZED);
    // Un seul corps possible : ni cause, ni indice (revocable/expired/WWW-Authenticate
    // ne parle que du type de jeton, pas de la raison du refus).
    const corps: unknown = JSON.parse(
      '{"error":{"code":"unauthorized","message":"jeton d\'appareil invalide"}}',
    );
    expect(corps).toEqual({ error: { code: "unauthorized", message: "jeton d'appareil invalide" } });
    const router = read(join(SERVER_API, "router.ts"));
    expect(router).toContain('apiError("unauthorized", "jeton d\'appareil invalide")');
    const errors = read(join(SERVER_API, "errors.ts"));
    expect(errors).toContain("unauthorized: 401");

    // Aucune mention de cause (expiré/révoqué/inconnu) dans le CODE Kotlin du
    // garde-fou et du repository : l'app ne devine rien (commentaires exclus).
    const forbidden = /revok|révoqu|expir|unknown device|inconnu/i;
    expect(forbidden.test(codeOnly(read(kt.api)))).toBe(false);
    expect(forbidden.test(codeOnly(read(kt.synced)))).toBe(false);
    expect(forbidden.test(codeOnly(read(kt.sse)))).toBe(false);
  });

  test("garde-fou : 401 + route protégée + bearer parti = signal, sinon rien", () => {
    expect(tsIsSessionRejection(HTTP_UNAUTHORIZED, "/v1/grades", true)).toBe(true);
    expect(tsIsSessionRejection(HTTP_UNAUTHORIZED, "/v1/media?ref=discussion%3Ad1", true)).toBe(true);
    expect(tsIsSessionRejection(HTTP_UNAUTHORIZED, "/v1/events", true)).toBe(true);
    // 401 sur route PUBLIQUE = appairage refusé, pas une session perdue.
    for (const p of PUBLIC_PATHS) {
      expect(tsIsSessionRejection(HTTP_UNAUTHORIZED, p, true)).toBe(false);
    }
    // Jamais appairé (aucun bearer parti) : rien à réparer, donc pas de boucle
    // d'appairage pour une app qui n'a jamais appairé.
    expect(tsIsSessionRejection(HTTP_UNAUTHORIZED, "/v1/grades", false)).toBe(false);
    // Les autres statuts restent de l'affichage ordinaire.
    for (const code of [200, 304, 404, 409, 500, 501, 503]) {
      expect(tsIsSessionRejection(code, "/v1/grades", true)).toBe(false);
    }

    // Un seul endroit lève le signal (pas de 401 traité écran par écran) et un
    // seul endroit s'y abonne.
    const files = [...readdirSync(DATA).map((f) => join(DATA, f)), ...readdirSync(UI).map((f) => join(UI, f))];
    const raises = files.filter((f) => codeOnly(read(f)).includes("DeviceAuth.reject()"));
    const subs = files.filter((f) => codeOnly(read(f)).includes("DeviceAuth.setOnRejected"));
    expect(raises.map((f) => f.split("/").pop())).toEqual(["ApiClient.kt"]);
    expect(subs.map((f) => f.split("/").pop())).toEqual(["AppNav.kt"]);
    // Couverture : ApiClient est le SEUL endroit qui fabrique un OkHttpClient,
    // donc le garde-fou voit 100% des réponses (repositories, SSE, média,
    // appairage — les routes publiques seules en sont exemptes, par contrat).
    const clients = files.filter((f) => codeOnly(read(f)).includes("OkHttpClient("));
    expect(clients.map((f) => f.split("/").pop())).toEqual(["ApiClient.kt"]);
    const calls = files.filter((f) => codeOnly(read(f)).includes("newCall("));
    expect(calls.length).toBeGreaterThan(8);
    for (const f of calls) {
      expect({ file: f.split("/").pop(), viaApi: codeOnly(read(f)).includes("api.client().newCall(") }).toEqual({
        file: f.split("/").pop(),
        viaApi: true,
      });
    }
  });

  test("anti-boucle : le refus est réparé UNE fois, pas rejoué en boucle", () => {
    const app = new TsAppOn401();
    // 5 requêtes protégées qui reviennent toutes en 401 (token révoqué).
    for (const p of ["/v1/grades", "/v1/assignments", "/v1/timetable", "/v1/news", "/v1/menus"]) {
      app.reply(HTTP_UNAUTHORIZED, p);
    }
    expect(app.raises).toBe(1); // un seul signal, donc une seule réparation
    expect(app.logouts).toBe(1);
    expect([...app.purged].sort()).toEqual([...CACHEABLE_RESOURCES].sort());
    expect(app.navigations).toEqual(["pairing"]);
    expect(app.route).toBe("pairing");
    expect(app.notice).toBe(REJECTED_MESSAGE);
    // Après réparation, plus aucun bearer ne part : les 401 suivants (routes
    // protégées, utilisateur non appairé) NE relancent rien. C'est la garantie
    // qu'on ne retombe pas indéfiniment sur l'écran d'appairage.
    expect(app.token).toBeNull();
    for (const p of ["/v1/grades", "/v1/assignments", "/v1/timetable"]) app.reply(HTTP_UNAUTHORIZED, p);
    expect(app.raises).toBe(1);
    expect(app.navigations).toEqual(["pairing"]);
    // Le signal ne se déclenche pas non plus sur une panne réseau ou un 500.
    const other = new TsAppOn401();
    for (const code of [500, 503, 404]) other.reply(code, "/v1/grades");
    expect(other.raises).toBe(0);
    expect(other.token).not.toBeNull(); // session intacte, cache/repli habituels
  });

  test("SSE : un 401 arrête le flux au lieu de boucler sur un jeton mort", () => {
    const forever = Array.from({ length: 40 }, () => HTTP_UNAUTHORIZED);
    // Avant le garde-fou : reconnexion jusqu'au plafond, le même jeton rejoué.
    expect(tsSseRun(forever, false).connects).toBeGreaterThan(1);
    // Après : une seule connexion, état Failed, aucune reconnexion.
    expect(tsSseRun(forever, true)).toEqual({ connects: 1, failed: true });
    // Une panne serveur reste, elle, un retry borné (comportement inchangé).
    const panne = Array.from({ length: 40 }, () => 503);
    expect(tsSseRun(panne, true).connects).toBe(40);
    expect(tsSseRun([200], true)).toEqual({ connects: 1, failed: false });

    const sse = read(kt.sse);
    expect(sse).toContain("if (code == ApiClient.HTTP_UNAUTHORIZED) {");
    expect(sse).toContain("closed = true");
    expect(sse).toContain("SseState.Failed(DeviceAuth.REJECTED_MESSAGE)");
    // La sortie 401 précède le scheduleRetry : on ne reprogramme aucun essai.
    expect(sse.indexOf("if (code == ApiClient.HTTP_UNAUTHORIZED) {")).toBeLessThan(
      sse.indexOf('scheduleRetry(listener, "HTTP $code")'),
    );
    expect(sse).toContain("private const val MAX_ATTEMPTS_BEFORE_FAILED = 20");
  });

  test("Kotlin : un seul point d'observation, message neutre, réparation par logout()", () => {
    const api = read(kt.api);
    // UN intercepteur partagé par toutes les requêtes (repositories, SSE, média).
    expect(api).toContain("client: OkHttpClient = OkHttpClient()");
    expect(api).toContain("client.newBuilder()");
    expect(api).toContain("addInterceptor(UnauthorizedGuard { isPublicPath(it) })");
    expect(api).toContain("const val HTTP_UNAUTHORIZED = 401");
    expect(api).toContain('private const val HEADER_AUTHORIZATION = "Authorization"');
    expect(api).toContain("DeviceAuth.reject()");
    expect(api).toContain("fun setOnRejected(listener: (() -> Unit)?)");
    // Le rejet est conditionné par les trois garde-fous, dans le bon ordre.
    const apiCode = codeOnly(api);
    expect(apiCode).toContain("response.code == ApiClient.HTTP_UNAUTHORIZED");
    expect(apiCode).toContain("!isPublic(request.url.encodedPath)");
    expect(apiCode).toContain("request.header(HEADER_AUTHORIZATION) != null");
    const dernierGarde = apiCode.indexOf("request.header(HEADER_AUTHORIZATION) != null");
    expect(apiCode.indexOf("response.code == ApiClient.HTTP_UNAUTHORIZED")).toBeLessThan(dernierGarde);
    expect(apiCode.indexOf("!isPublic(request.url.encodedPath)")).toBeLessThan(dernierGarde);
    expect(dernierGarde).toBeLessThan(apiCode.indexOf("DeviceAuth.reject()"));
    // Le bearer reste attaché à la construction, sur les mêmes règles qu'avant.
    expect(api).toContain('builder.header("Authorization", "Bearer $token")');
    expect(api).toContain("private fun builder(path: String): Request.Builder");
    for (const p of ["PAIRING_START_PATH", "PAIRING_CONFIRM_PATH", "HEALTH_PATH"]) {
      expect(api).toContain(`ServerConfig.${p}`);
    }
    // Message unique, sans cause devinée (le serveur ne dit rien de plus).
    const message = /const val REJECTED_MESSAGE = "([^"]+)"/.exec(api)?.[1];
    expect(message).toBe(REJECTED_MESSAGE);
    expect(message).not.toMatch(/expir|révoqu|inconnu/i);

    // Le repository réutilise la plomberie existante (RefreshOutcome.Failed),
    // aucune file de retry ni nouveau type d'échec.
    const synced = read(kt.synced);
    expect(synced).toContain("it.code == ApiClient.HTTP_UNAUTHORIZED");
    expect(synced).toContain("RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE, null)");
    expect(synced).toContain("sealed interface RefreshOutcome");
    expect(codeOnly(synced)).not.toContain("setOnRejected");

    // Traitement unique côté UI : réparation par le chemin EXISTANT puis
    // navigation vers l'appairage (pile vidée : plus d'onglet protégé derrière).
    const nav = read(kt.nav);
    expect(nav).toContain('const val ROUTE_PAIRING = "pairing"');
    expect(nav).toContain("DeviceAuth.setOnRejected");
    expect(nav).toContain("accounts.logout()");
    expect(nav).toContain("authNotice = DeviceAuth.REJECTED_MESSAGE");
    expect(nav).toContain("if (nav.currentDestination?.route != ROUTE_PAIRING) {");
    expect(nav).toContain("nav.navigate(ROUTE_PAIRING) {");
    expect(nav).toContain("popUpTo(nav.graph.findStartDestination().id) { inclusive = true }");
    expect(nav).toContain("onDispose { DeviceAuth.setOnRejected(null) }");
    expect(nav).toContain("notice = authNotice,");
    const navCode = codeOnly(nav);
    // Pas de purge parallèle : tout passe par AccountStore.logout().
    expect(navCode).not.toContain("clearAll(");
    expect(navCode).not.toContain("tokenStore.clear(");
    // Jamais de secret journalisé.
    expect(navCode).not.toMatch(/Log\.[vdiew]\(|println\(/);
    expect(codeOnly(api)).not.toMatch(/Log\.[vdiew]\(|println\(/);

    // Le chemin de purge est bien celui du AccountStore existant.
    const accounts = read(kt.accounts);
    expect(accounts).toContain("fun logout()");
    expect(accounts).toContain("tokenStore.clear()");
    expect(accounts).toContain("cacheStore.clearAll()");
    // Le secret reste chiffré et effacé par le store, jamais recopyé ailleurs.
    const tokens = read(kt.tokens);
    expect(tokens).toContain("EncryptedSharedPreferences");
    expect(tokens).toContain("fun clear()");
    expect(tokens).toContain("remove(KEY_TOKEN)");

    // L'écran d'appairage affiche la raison factuelle, sans chrono ni devinette.
    const pairing = read(kt.pairing);
    expect(pairing).toContain("notice: String? = null,");
    expect(pairing).toContain("if (!notice.isNullOrEmpty()) Text(notice)");
    expect(pairing).toContain("tokens.save(res.device.id, res.device.tokenHash, res.device.token)");
  });
});
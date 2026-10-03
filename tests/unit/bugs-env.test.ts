// Chasse aux bugs de chargement d'env (server/infrastructure/env.ts et ses
// consommateurs). Chaque test est RED sur un défaut réel, pas sur le harnais.
// Valeurs 100 % synthétiques : aucun secret réel n'est lu ni écrit.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadRequiredEnv } from "../../server/infrastructure/env";
import { start } from "../../server/infrastructure/http";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/** start() appelle Bun.serve : on capture le port demandé sans ouvrir de socket. */
function portsRequestedByStart(env: Record<string, string | undefined>): number[] {
  const seen: number[] = [];
  const realServe = Bun.serve;
  Bun.serve = ((opts: { port: number }) => {
    seen.push(opts.port);
    return { port: opts.port, stop() {}, reload() {} };
  }) as unknown as typeof Bun.serve;
  try {
    start(env);
  } catch {
    // Config refusée au boot : aucun port ne part dans Bun.serve.
  } finally {
    Bun.serve = realServe;
  }
  return seen;
}

/** Message d'erreur de boot, ou null si le démarrage est passé. */
function startError(env: Record<string, string | undefined>): string | null {
  const realServe = Bun.serve;
  Bun.serve = ((opts: { port: number }) => ({
    port: opts.port,
    stop() {},
    reload() {},
  })) as unknown as typeof Bun.serve;
  try {
    start(env);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    Bun.serve = realServe;
  }
}

describe("unit bugs env", () => {
  test('BUG: loadRequiredEnv lit la chaîne de prototypes — une clé présente sur Object.prototype crash (TypeError) au lieu de valoir "absente"', () => {
    // env.ts:15 : `env[k]` sans garde own-property. Sur un objet d'env normal,
    // `toString`/`constructor`/`valueOf`/`__proto__` sont « présents » via
    // Object.prototype -> cleanEnvValue appelle .trim() sur une fonction/objet
    // et lève au lieu de retourner null (config absente).
    expect(loadRequiredEnv({}, ["toString"])).toBeNull();
  });

  test("BUG: __proto__ avalé à l'écriture — loadRequiredEnv renvoie un objet non-null SANS la clé requise (secret = Object.prototype)", () => {
    // env.ts:13/17 : `out = {}` + `out[k] = v`. Sur "__proto__", l'affectation
    // passe par le setter de Object.prototype : la valeur N'EST PAS stockée,
    // loadRequiredEnv renvoie quand même un objet non-null, et le lecteur
    // relit Object.prototype au lieu du secret attendu.
    const env = Object.create(null) as Record<string, string | undefined>;
    env["__proto__"] = "jeton-synthetique";
    const out = loadRequiredEnv(env, ["__proto__"]);
    expect(out).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(out as Record<string, string>, "__proto__")).toBe(true);
  });

  test("BUG: PORT hors plage non validé — start() transmet -1/70000 à Bun.serve (crash opaque au boot, aucun message de config)", () => {
    // http.ts:212 : `Number.parseInt(...) || DEFAULT_PORT` ne valide ni la plage
    // ni l'intégralité. Un port impossible part tel quel dans Bun.serve, qui
    // rejette au démarrage sans nommer la variable fautive.
    const seen = portsRequestedByStart({ PORT: "-1" });
    expect(seen).not.toContain(-1);
    expect(portsRequestedByStart({ PORT: "70000" })).not.toContain(70000);
    // Le refus nomme la variable fautive (le crash opaque de Bun.serve ne le fait pas).
    expect(startError({ PORT: "-1" })).toContain("PORT");
    expect(startError({ PORT: "70000" })).toContain("PORT");
  });

  test("BUG: PORT=0 avalé par `||` — le port éphémère demandé est silencieusement remplacé par le défaut 3000", () => {
    // http.ts:212 : `0 || 3000` => 3000. PORT=0 (demande de port libre,
    // convention Docker/Node) est confondu avec « absent » -> collision avec le
    // port par défaut au lieu d'un bind éphémère.
    expect(portsRequestedByStart({ PORT: "0" })).toEqual([0]);
  });

  test("BUG: .env.example déclare DATABASE_URL/MASTER_KEY jamais lus par le serveur — config active en apparence, ignorée en réalité", () => {
    // Une clé documentée dans .env.example mais lue nulle part donne une fausse
    // assurance : l'opérateur croit la persistance (DATABASE_URL) et le
    // secret maître (MASTER_KEY) actifs alors que le serveur les ignore.
    const example = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    const keys = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThan(10);
    const serverDir = join(REPO_ROOT, "server");
    const sources = readdirSync(serverDir, { recursive: true })
      .filter((f) => String(f).endsWith(".ts"))
      .map((f) => readFileSync(join(serverDir, String(f)), "utf8"))
      .join("\n");
    expect(keys.filter((k) => !sources.includes(k))).toEqual([]);
  });
});
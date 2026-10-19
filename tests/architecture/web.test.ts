import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, pronoteHost } from "../../agents/runtime/source-guards";
import {
  BRIDGE_METHODS,
  MAX_NATIVE_WAIT_MS,
  NATIVE_WAIT_MS,
} from "../../web/src/bridge/types";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web");
const BRIDGE = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt");

function list(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|css|html)$/.test(entry)) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/** Méthodes que le pont Kotlin expose au JS (`@JavascriptInterface`). */
function kotlinExposed(source: string): string[] {
  return [...source.matchAll(/@JavascriptInterface\s+fun\s+(\w+)\s*\(/g)].map((m) => m[1]!);
}

/** Allowlist `METHODS` du pont Kotlin (les noms que `call` accepte). */
function kotlinMethods(source: string): string[] {
  const block = /METHODS\s*=\s*setOf\(([\s\S]*?)\n\s*\)/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** Constantes `const val` numériques du pont Kotlin (en ms). */
function kotlinConstants(source: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of source.matchAll(/(?:private\s+)?const\s+val\s+(\w+)\s*=\s*([\d_]+)L?/g)) {
    out.set(m[1]!, Number(m[2]!.replace(/_/g, "")));
  }
  return out;
}

/** Plafond d'attente natif, lu dans le source Kotlin (somme des plafonds). */
function kotlinCeiling(source: string): number {
  const constants = kotlinConstants(source);
  const expr = /const\s+val\s+MAX_NATIVE_WAIT_MS\s*=\s*([^\n]+)/.exec(source)?.[1] ?? "";
  let total = 0;
  for (const term of expr.split("+").map((t) => t.trim()).filter(Boolean)) {
    if (/^\d+$/.test(term)) total += Number(term);
    else if (constants.has(term)) total += constants.get(term)!;
    else throw new Error(`plafond natif illisible : ${term}`);
  }
  return total;
}

describe("web invariants", () => {
  test("aucun accès réseau depuis la WebView", () => {
    const net = /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon|import\s*\(["']https?:/;
    const hits = list(join(WEB, "src"))
      .filter((file) => net.test(codeOnly(readFileSync(file, "utf8"))))
      .map((file) => file.replace(ROOT, ""));
    expect(hits).toEqual([]);
  });

  test("CSP verrouillée et aucun contenu distant", () => {
    const html = readFileSync(join(WEB, "index.html"), "utf8");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'self'");
    expect(html).not.toMatch(/https?:\/\/(?!appassets)/);
    const css = list(join(WEB, "src")).filter((f) => f.endsWith(".css"));
    for (const file of css) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/url\(\s*["']?https?:/);
    }
  });

  test("aucun HTML construit depuis un payload", () => {
    const hits = list(join(WEB, "src"))
      .filter((file) => /dangerouslySetInnerHTML|innerHTML\s*=|document\.write/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(ROOT, ""));
    expect(hits).toEqual([]);
  });

  test("aucun hôte Pronote dans le web", () => {
    const hits = list(join(WEB, "src"))
      .filter((file) => pronoteHost.test(codeOnly(readFileSync(file, "utf8"))))
      .map((file) => file.replace(ROOT, ""));
    expect(hits).toEqual([]);
  });

  test("aucun secret persisté côté JS", () => {
    const hits = list(join(WEB, "src"))
      .filter((file) => {
        const code = codeOnly(readFileSync(file, "utf8"));
        return /localStorage\.setItem\([^)]*(token|password|jeton|apiKey|llmKey)/i.test(code);
      })
      .map((file) => file.replace(ROOT, ""));
    expect(hits).toEqual([]);
  });

  test("un appairage réussi ouvre la session côté web", () => {
    // Le statut lu au démarrage est périmé après un appairage : sans ce
    // câblage, le garde-fou renvoie vers /pairing et le menu principal
    // reste inaccessible sans redémarrer l'application (#357).
    const ctx = readFileSync(join(WEB, "src/ui/AppContext.tsx"), "utf8");
    expect(ctx).toContain("setSessionOpen(true)");
    expect(ctx).toContain("setAuthLost(false)");
    const pairing = readFileSync(join(WEB, "src/features/pairing/PairingScreen.tsx"), "utf8");
    expect(pairing).toContain("openSession()");
    const app = readFileSync(join(WEB, "src/App.tsx"), "utf8");
    expect(app).toContain("sessionOpen");
    expect(app).toContain("mustPair(");
  });

  test("une déconnexion ferme la session côté web", () => {
    // Le natif invalide la session et purge les caches ; sans cette fermeture
    // côté interface, le garde-fou laisse l'accueil d'un compte déconnecté
    // afficher « aucune donnée en cache » pour toujours (#360).
    const ctx = readFileSync(join(WEB, "src/ui/AppContext.tsx"), "utf8");
    expect(ctx).toContain("setSessionClosed(true)");
    const profile = readFileSync(join(WEB, "src/features/profile/ProfileScreen.tsx"), "utf8");
    expect(profile).toContain("closeSession");
    const app = readFileSync(join(WEB, "src/App.tsx"), "utf8");
    expect(app).toContain("sessionClosed");
  });
});

describe("contrat du pont natif", () => {
  test("le pont n'expose qu'une seule interface au JS", () => {
    // I10 / ADR-004 : UNE SEULE interface (`call`). Un second
    // `@JavascriptInterface` (l'ancien `cancel`) rendait une méthode
    // appelable par n'importe quel JS de la WebView, hors allowlist.
    const kotlin = readFileSync(BRIDGE, "utf8");
    expect(kotlinExposed(kotlin)).toEqual(["call"]);
    const client = readFileSync(join(WEB, "src/bridge/client.ts"), "utf8");
    const surface = /interface VsnNative \{([\s\S]*?)\n\}/.exec(client)?.[1] ?? "";
    expect([...surface.matchAll(/^\s*(\w+)\s*\(/gm)].map((m) => m[1]!)).toEqual(["call"]);
  });

  test("les méthodes du pont Kotlin sont exactement l'union TS", () => {
    // Parité 1:1 : une méthode présente d'un seul côté est un trou (le JS
    // l'appellera et le natif refusera, ou l'inverse : une méthode
    // appelable hors contrat).
    const kotlin = readFileSync(BRIDGE, "utf8");
    const allowlist = kotlinMethods(kotlin);
    expect(new Set(allowlist)).toEqual(new Set(BRIDGE_METHODS));
    expect(allowlist.length).toBe(BRIDGE_METHODS.length);
    // L'allowlist couvre l'union : rien ne reste hors contrat.
    for (const method of BRIDGE_METHODS) expect(allowlist).toContain(method);
  });

  test("le plafond d'attente natif est le même des deux côtés", () => {
    const kotlin = readFileSync(BRIDGE, "utf8");
    const constants = kotlinConstants(kotlin);
    expect(constants.get("AWAIT_DEFAULT_MS")).toBe(NATIVE_WAIT_MS.default);
    expect(constants.get("AWAIT_LLM_MS")).toBe(NATIVE_WAIT_MS.llm);
    expect(kotlinCeiling(kotlin)).toBe(MAX_NATIVE_WAIT_MS);
  });

  test("l'appairage n'envoie jamais le message brut au JS (#396)", () => {
    // Un message d'exception peut nommer l'hôte de l'établissement (adresse
    // interne, port) : il ne franchit pas la frontière native/JS (I10). Le
    // pont ne transmet que le CODE et rend une phrase choisie par lui.
    const kotlin = readFileSync(BRIDGE, "utf8");
    const debut = kotlin.indexOf("private fun pair(");
    expect(debut).toBeGreaterThan(-1);
    const corps = kotlin.slice(debut, kotlin.indexOf("private fun cancelPairing(", debut));
    expect(corps).toContain("pairingFailureMessage(result.code)");
    expect(corps).not.toContain("result.message");

    // La table du pont ne nomme ni hôte, ni IP, ni port.
    const table = readFileSync(
      join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/PairingMessages.kt"),
      "utf8",
    );
    expect(table).not.toMatch(/(?:\d{1,3}\.){3}\d{1,3}/);
    expect(table).not.toContain("://");
    expect(table).not.toMatch(/:\d{2,5}\b/);
  });
});

// DAT-06 : la démo de l'éditeur est une porte de DÉVELOPPEMENT. Une release ne
// peut ni l'afficher ni ouvrir le compte, et une session de démo laissée sur
// le disque ne se restaure pas. Le build est la seule autorité : le web ne
// décide rien, il lit `app.ready`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP_GRADLE = join(ROOT, "android", "app", "build.gradle.kts");
const DATA_GRADLE = join(ROOT, "android", "data", "build.gradle.kts");
const BRIDGE = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app", "VsnBridge.kt");
const REPO = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data", "PairingRepository.kt");
const SCREEN = join(ROOT, "web", "src", "features", "pairing", "PairingScreen.tsx");
const CLIENT = join(ROOT, "web", "src", "bridge", "client.ts");

const read = (path: string): string => readFileSync(path, "utf8");

function gradleBlock(source: string, name: string): string {
  const start = source.indexOf(`${name} {`);
  expect({ block: name, found: start >= 0 }).toEqual({ block: name, found: true });
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`bloc Gradle non fermé : ${name}`);
}

describe("démo réservée aux builds de développement", () => {
  test("le drapeau DEMO_MODE est vrai en debug, faux en release", () => {
    for (const gradlePath of [APP_GRADLE, DATA_GRADLE]) {
      const gradle = read(gradlePath);
      const debug = gradleBlock(gradle, "debug");
      const release = gradleBlock(gradle, "release");
      expect({ gradlePath, debug: debug.includes('buildConfigField("Boolean", "DEMO_MODE", "true")') }).toEqual({
        gradlePath,
        debug: true,
      });
      expect({ gradlePath, release: release.includes('buildConfigField("Boolean", "DEMO_MODE", "false")') }).toEqual({
        gradlePath,
        release: true,
      });
    }
  });

  test("le pont refuse la démo AVANT d'ouvrir la session", () => {
    const bridge = codeOnly(read(BRIDGE));
    const guard = bridge.indexOf("if (!BuildConfig.DEMO_MODE)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(bridge.indexOf("pairing.pairDemoBlocking()"));
    expect(bridge).toContain('.put("demo", BuildConfig.DEMO_MODE)');
  });

  test("le dépôt refuse la démo et ne restaure pas une session de démo en release", () => {
    const repo = codeOnly(read(REPO));
    // Deux gardes : ouverture explicite et restauration d'une session disque.
    expect(repo.match(/if \(!BuildConfig\.DEMO_MODE\)/g)).toHaveLength(2);
    const demo = repo.indexOf("fun pairDemoBlocking()");
    const login = repo.indexOf("Client.demoLogin()");
    expect(demo).toBeGreaterThan(-1);
    expect(repo.indexOf("if (!BuildConfig.DEMO_MODE)", demo)).toBeGreaterThan(demo);
    expect(repo.indexOf("if (!BuildConfig.DEMO_MODE)", demo)).toBeLessThan(login);
    expect(repo).toContain("return RestoreResult.NoSession");
    expect(repo).toContain("CacheScope.onSessionDead(cacheStore)");
  });

  test("l'écran ne rend le bouton que si le natif annonce la démo", () => {
    const screen = read(SCREEN);
    expect(screen).toContain(".ready()");
    expect(screen).toContain("ready.demo === true");
    expect(screen).toContain("demoAvailable ? (");
    expect(screen.indexOf("Connexion démo")).toBeGreaterThan(screen.indexOf("demoAvailable ? ("));
    // Faux par défaut : aucune fenêtre où une release affiche le bouton.
    expect(screen).toContain("useState(false)");
    expect(read(CLIENT)).toContain('call<{ ok: true; demo: boolean }>("app.ready")');
  });
});

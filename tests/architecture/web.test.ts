import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, pronoteHost } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web");

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
});

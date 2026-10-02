import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

// ponytail: miroir volontaire de check-architecture.ts (regex simples). Upgrade: importer helpers partagés ou AST.
function codeOnly(content: string): string {
  const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/<!--[\s\S]*?-->/g, "\n");
  return noBlock
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("#") && !t.startsWith("<!--");
    })
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");
}

const pronoteHost = /pronote|index-education|ent\.(ac-|cas|nevers)|cas\./i;
const netRe = /fetch\(|axios|got\(|https?\.(get|request)|Bun\.serve|XMLHttpRequest|WebSocket/;
const pronoteUrlRe = /https?:\/\/[^\s"']*(pronote|index-education|ent\.(ac-|cas|nevers))/i;
function hasDirectFetch(code: string): boolean {
  if (code.split("\n").some((l) => pronoteHost.test(l) && netRe.test(l))) return true;
  return pronoteUrlRe.test(code) && netRe.test(code);
}
const sqliteRe =
  /import\s+[^;]*sqlite|from\s+['"][^'"]*sqlite|require\s*\([^)]*sqlite|bun:sqlite|better-sqlite3/i;
const httpRe = /from\s+['"]hono|from\s+['"]express|require\s*\([^)]*(hono|express|fastify)|Bun\.serve/;

function list(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if ([".git", "node_modules"].includes(e)) continue;
        walk(p);
      } else if (/\.(ts|tsx|kt|kts|java)$/.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("invariants", () => {
  test("I1: android sans hote Pronote/ENT", () => {
    const files = list(join(ROOT, "android")).filter((f) => {
      if (f.endsWith(".md")) return false;
      try {
        return pronoteHost.test(codeOnly(readFileSync(f, "utf8")));
      } catch {
        return false;
      }
    });
    expect({ files }).toEqual({ files: [] });
  });

  test("I1 FP: commentaires et docs ignorés", () => {
    expect(pronoteHost.test(codeOnly("// voir pronote\nconst a = 1;"))).toBe(false);
    expect(pronoteHost.test(codeOnly("/* https://pronote.example */\nconst a = 1;"))).toBe(false);
    expect(pronoteHost.test(codeOnly("const a = 1; // pronote"))).toBe(false);
    expect(pronoteHost.test(codeOnly('const url = "https://api.example.fr/x";'))).toBe(false);
    expect(pronoteHost.test(codeOnly('const url = "https://pronote.example.fr/";'))).toBe(true);
  });

  test("I3: domain sans sqlite ni framework HTTP", () => {
    const files = list(join(ROOT, "server/domain")).filter((f) => {
      const code = codeOnly(readFileSync(f, "utf8"));
      return sqliteRe.test(code) || httpRe.test(code);
    });
    expect(files).toEqual([]);
  });

  test("I3 FP: block/javadoc ignorés, multi-lignes détecté", () => {
    expect(sqliteRe.test(codeOnly("/* import sqlite */\nconst a = 1;"))).toBe(false);
    expect(sqliteRe.test(codeOnly("* import sqlite\nconst a = 1;"))).toBe(false);
    expect(httpRe.test(codeOnly('// from "hono"\nconst a = 1;'))).toBe(false);
    expect(sqliteRe.test(codeOnly('import {\n Database\n} from "bun:sqlite";'))).toBe(true);
    expect(httpRe.test(codeOnly('import { Hono } from "hono";'))).toBe(true);
    expect(sqliteRe.test(codeOnly('const a = 1; // sqlite'))).toBe(false);
  });

  test("I2: un seul PronoteHttpClient", () => {
    const server = list(join(ROOT, "server"));
    const defs = server.filter((f) => /class PronoteHttpClient/.test(readFileSync(f, "utf8")));
    expect(defs.length).toBeLessThanOrEqual(1);
  });

  test("I2 FP: fetch hors Pronote ignoré, accès direct détecté", () => {
    // FP: mot pronote + fetch sur lignes différentes, sans URL → ignoré
    expect(hasDirectFetch(codeOnly("const p = pronoteProvider;\nawait fetch(apiUrl);"))).toBe(false);
    // FP: commentaire seul → ignoré
    expect(hasDirectFetch(codeOnly("// fetch pronote\nconst a = 1;"))).toBe(false);
    // vrai positif: même ligne
    expect(hasDirectFetch(codeOnly('await fetch("https://pronote.example.fr/x");'))).toBe(true);
    // vrai positif: URL Pronote + réseau ailleurs
    expect(
      hasDirectFetch(codeOnly('const u = "https://index-education.net/pronote/";\nawait fetch(u);')),
    ).toBe(true);
  });

  test("I4/I5: server/ai sans reseau/secrets/outils", () => {
    const aiFiles = list(join(ROOT, "server/ai"));
    expect(aiFiles.length).toBeGreaterThanOrEqual(2);
    const secretRe =
      /sk-or-v1-|OPENROUTER_API_KEY|MASTER_KEY|PRONOTE_PASSWORD|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/;
    for (const f of aiFiles) {
      const c = codeOnly(readFileSync(f, "utf8"));
      expect({ file: f, kind: "secret" }).toEqual({ file: f, kind: "secret" });
      expect(c).not.toMatch(secretRe);
      expect(c).not.toMatch(/Bun\.env|process\.env/);
      expect(c).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|Bun\.serve/);
      expect(c).not.toMatch(/tools\s*[:=]\s*\[[^\]]*[^\s\]]/);
    }
  });

  test("I6: pipeline Untrusted + nonce partout dans server/ai", () => {
    const aiFiles = list(join(ROOT, "server/ai"));
    const untrusted = aiFiles.find((f) => f.endsWith("untrusted.ts"));
    expect(untrusted).toBeDefined();
    const base = codeOnly(readFileSync(untrusted!, "utf8"));
    expect(base).toContain("UNTRUSTED_DATA");
    expect(base).toContain("nonce");
    expect(base).toContain("createNonce");
    for (const f of aiFiles) {
      if (f.endsWith("untrusted.ts")) continue;
      const c = readFileSync(f, "utf8");
      expect(c).toMatch(/from\s+["']\.\/untrusted["']/);
      expect(c).toMatch(/markExternal|wrapUntrusted|buildSafePrompt/);
    }
    const ports = codeOnly(readFileSync(join(ROOT, "server/domain/ports.ts"), "utf8"));
    expect(ports).toContain("untrusted");
  });

  test("I7: jobs sans LLM, effets sur donnees structurees uniquement", () => {
    const jobFiles = list(join(ROOT, "server/jobs"));
    expect(jobFiles.length).toBeGreaterThan(0);
    const offenders = jobFiles.filter((f) => {
      const c = codeOnly(readFileSync(f, "utf8"));
      return (
        /server\/ai|LLMProvider|from\s+['"][^'"]*\/ai['"]/.test(c) ||
        /\bgenerate\s*\(/.test(c) ||
        /fetch\s*\(/.test(c)
      );
    });
    expect({ offenders }).toEqual({ offenders: [] });
  });
});

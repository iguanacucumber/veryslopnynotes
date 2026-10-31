// Sortie de gate BORNÉE (I5) : l'affichage plafonne à 10 items, une ligne par
// item, mais le VERDICT garde tout — le reste part dans un log à chemin stable.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bound, MAX_ITEMS, repoPath } from "../../agents/runtime/output";

describe("sortie de gate bornée", () => {
  test("≤ 10 items : tout s'affiche, aucun log", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-output-"));
    try {
      expect(bound(dir, "etape", ["a", "b"])).toEqual(["a", "b"]);
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("> 10 items : 10 lignes, `reste`, et le log complet à chemin stable", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-output-"));
    try {
      const items = Array.from({ length: 111 }, (_, i) => `ligne ${i}`);
      const lignes = bound(dir, "etape", items);
      expect(lignes.length).toBe(MAX_ITEMS + 1);
      expect(lignes.at(-1)).toContain("… reste: 101");
      expect(lignes.at(-1)).toContain("node_modules/.cache/gate-logs/etape.log");
      // Le log complet contient TOUS les items : borner l'affichage ne filtre pas le verdict.
      const log = join(dir, "node_modules", ".cache", "gate-logs", "etape.log");
      expect(existsSync(log)).toBe(true);
      expect(readFileSync(log, "utf8").trimEnd().split("\n")).toEqual(items);
      // Les chemins s'affichent relatifs au dépôt, jamais absolus.
      expect(repoPath(dir, join(dir, "android", "App.kt"))).toBe("android/App.kt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

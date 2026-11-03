// Le budget de fontes est mesuré en gzip, hors processus : un fichier non
// sous-ensemblé ou une graisse ajoutée fait rougir le build.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSize, measureFontBudget } from "../../agents/runtime/font-budget";

function dossier(): string {
  return mkdtempSync(join(tmpdir(), "vsn-font-budget-"));
}

describe("budget des fontes WOFF2", () => {
  test("mesure le brut et le gzip de chaque fichier", () => {
    const dir = dossier();
    try {
      const data = new TextEncoder().encode("SN Pro".repeat(50));
      writeFileSync(join(dir, "SNPro-Regular.woff2"), data);
      const budget = measureFontBudget(dir);
      expect(budget.failures).toEqual([]);
      expect(budget.fonts).toEqual([
        { name: "SNPro-Regular.woff2", bytes: data.byteLength, gzip: gzipSize(data) },
      ]);
      expect(budget.totalGzip).toBe(gzipSize(data));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un dossier sans fonte est un échec, pas un vert vide", () => {
    const dir = dossier();
    try {
      const budget = measureFontBudget(dir);
      expect(budget.failures.length).toBe(1);
      expect(budget.failures[0]).toContain("aucune fonte WOFF2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dépasser le total ou le plafond par fichier est nommé", () => {
    const dir = dossier();
    try {
      writeFileSync(join(dir, "SNPro-Regular.woff2"), "un fichier trop lourd");
      const budget = measureFontBudget(dir, { totalGzip: 1, maxGzip: 1 });
      expect(budget.failures.some((f) => f.includes("sous-ensemble oublié"))).toBe(true);
      expect(budget.failures.some((f) => f.includes("budget dépassé"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Budget des fontes embarquées, en gzip : un WOFF2 déjà compressé ne doit pas
// reprendre du poids par accident (graisse ajoutée, fichier non sous-ensemblé).
// Le build APK passe par `build-web.ts`, qui refuse le bundle hors budget.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Total des fontes WOFF2 du bundle, gzip compris. */
export const FONT_BUDGET_GZIP_BYTES = 180 * 1024;

/** Plafond par fichier : un TTF complet (~90 Ko gzip) ne peut pas passer. */
export const FONT_MAX_GZIP_BYTES = 40 * 1024;

export interface FontSize {
  name: string;
  bytes: number;
  gzip: number;
}

export interface FontBudget {
  fonts: FontSize[];
  totalBytes: number;
  totalGzip: number;
  /** Violations lisibles ; vide = budget tenu. */
  failures: string[];
}

export interface FontBudgetLimits {
  totalGzip: number;
  maxGzip: number;
}

/** Taille gzip d'un fichier, sans passer par un processus. */
export function gzipSize(data: Uint8Array): number {
  return Bun.gzipSync(new Uint8Array(data)).byteLength;
}

/**
 * Mesure les `.woff2` d'un dossier de sortie (Vite les aplatit dans `assets/`).
 * Un dossier vide est un échec : le build doit livrer ses fontes.
 */
export function measureFontBudget(
  dir: string,
  limits: FontBudgetLimits = {
    totalGzip: FONT_BUDGET_GZIP_BYTES,
    maxGzip: FONT_MAX_GZIP_BYTES,
  },
): FontBudget {
  const racine = resolve(dir);
  let entrees: string[];
  try {
    entrees = readdirSync(racine);
  } catch {
    return {
      fonts: [],
      totalBytes: 0,
      totalGzip: 0,
      failures: [`dossier de fontes introuvable : ${racine}`],
    };
  }
  const noms = entrees
    .filter((name) => name.endsWith(".woff2"))
    .filter((name) => statSync(join(racine, name)).isFile())
    .sort();
  const fonts = noms.map((name) => {
    const data = readFileSync(join(racine, name));
    return { name, bytes: data.byteLength, gzip: gzipSize(data) };
  });
  const totalBytes = fonts.reduce((sum, f) => sum + f.bytes, 0);
  const totalGzip = fonts.reduce((sum, f) => sum + f.gzip, 0);
  const failures: string[] = [];
  if (fonts.length === 0) failures.push(`aucune fonte WOFF2 dans ${racine}`);
  for (const font of fonts) {
    if (font.gzip > limits.maxGzip) {
      failures.push(
        `${font.name} : ${ko(font.gzip)} gzip > ${ko(limits.maxGzip)} (sous-ensemble oublié ?)`,
      );
    }
  }
  if (totalGzip > limits.totalGzip) {
    failures.push(
      `total des fontes : ${ko(totalGzip)} gzip > ${ko(limits.totalGzip)} (budget dépassé)`,
    );
  }
  return { fonts, totalBytes, totalGzip, failures };
}

/** Une ligne de compte rendu, affichée par le build et les tests. */
export function describeFontBudget(budget: FontBudget): string {
  return (
    `fontes : ${budget.fonts.length} fichier(s), ${ko(budget.totalGzip)} gzip` +
    ` (${ko(budget.totalBytes)} brut)`
  );
}

function ko(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} Ko`;
}

// Rapport seul : `bun run agents/runtime/font-budget.ts [dossier]`.
if (import.meta.main) {
  const dir = process.argv[2] ?? join(import.meta.dir, "..", "..", "android", "app", "src", "main", "assets", "web", "assets");
  const budget = measureFontBudget(dir);
  console.log(describeFontBudget(budget));
  for (const font of budget.fonts) console.log(`  ${font.name}  ${ko(font.gzip)} gzip`);
  for (const failure of budget.failures) console.error(`  ÉCHEC : ${failure}`);
  if (budget.failures.length > 0) process.exitCode = 1;
}

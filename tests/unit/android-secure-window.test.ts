// #898 : les écrans portent une donnée scolaire, la clé LLM ou l'appairage.
// `FLAG_SECURE` ferme l'aperçu des applications récentes et les captures, mais
// rend `make shot` aveugle : le debug est exempté, la release jamais.
//
// Deux niveaux : la DÉCISION sur le VRAI Kotlin exécuté (harnais), puis le
// CÂBLAGE dans l'activité. Outillage absent = SKIP BRUYANT du harnais.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "SecureWindowParityMain.kt");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const ACTIVITY = codeOnly(readFileSync(join(APP, "MainActivity.kt"), "utf8"));
const SHOT = readFileSync(join(ROOT, "agents", "runtime", "shot.sh"), "utf8");

const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

async function secureUnderDebug(debug: boolean): Promise<boolean> {
  const res = JSON.parse(await link!.ask({ op: "secure", debug })) as { secure: boolean };
  return res.secure;
}

/** Corps de `applySecureWindow`, jusqu'à l'accolade qui le ferme. */
function applySecureWindowBody(source: string): string {
  const start = source.indexOf("private fun applySecureWindow()");
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return "";
}

describe("fenêtre protégée (#898)", () => {
  test.skipIf(skip)("la release exige FLAG_SECURE", async () => {
    expect(await secureUnderDebug(false)).toBe(true);
  });

  test.skipIf(skip)("le debug est exempté pour les captures de développement", async () => {
    expect(await secureUnderDebug(true)).toBe(false);
  });

  test("la décision vit dans un fichier PUR, sans dépendance Android", () => {
    const source = readFileSync(join(APP, "SecureWindow.kt"), "utf8");
    expect(codeOnly(source)).not.toMatch(/^import\s+android\./m);
    expect(source).toContain("fun secureWindowRequired");
  });

  test("l'activité pose FLAG_SECURE selon la décision, jamais en dur", () => {
    const body = applySecureWindowBody(ACTIVITY);
    // La décision de build est l'entrée : un `addFlags` nu ne serait pas exempté en debug.
    expect(body).toContain("secureWindowRequired(BuildConfig.DEBUG)");
    expect(body).toContain("WindowManager.LayoutParams.FLAG_SECURE");
    expect(ACTIVITY).toMatch(/override fun onCreate\([\s\S]*?applySecureWindow\(\)/);
  });

  test("l'exemption debug est bien celle de make shot", () => {
    // `make shot` capture un APK debug par `adb screencap` : sans exemption, la
    // capture serait noire et ne prouverait plus rien.
    expect(SHOT).toContain("app/build/outputs/apk/debug/app-debug.apk");
    expect(SHOT).toContain("screencap");
  });
});

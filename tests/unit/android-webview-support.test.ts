// #907 — la WebView minimale est une POLITIQUE exécutée, pas une phrase :
// le seuil et le message viennent du VRAI Kotlin (harnais de parité), et le
// câblage natif / l'affichage dans l'aide sont lus dans les sources.
// Outillage Kotlin absent = SKIP BRUYANT, jamais un faux vert.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const ACTIVITY_PATH = join(APP, "MainActivity.kt");
const SUPPORT_PATH = join(APP, "WebViewSupport.kt");
const DRIVER = join(ROOT, "agents/runtime/kotlin-parity/WebViewSupportParityMain.kt");

const read = (path: string) => readFileSync(path, "utf8");
const ACTIVITY = codeOnly(read(ACTIVITY_PATH));
const SUPPORT = read(SUPPORT_PATH);
const HELP = read(join(ROOT, "web/src/features/help/HelpScreen.tsx"));
const SETTINGS = read(join(ROOT, "web/src/features/settings/SettingsScreen.tsx"));
const README = read(join(ROOT, "README.md"));
const COMPATIBILITY = read(join(ROOT, "docs/COMPATIBILITY.md"));
const BUILD = read(join(ROOT, "android/app/build.gradle.kts"));

const skip = parityToolchain.skipReason !== null;
let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

interface Decision {
  supported: boolean;
  major: number | null;
  message: string;
}

interface Meta {
  minAndroid: number;
  minWebView: number;
  statement: string;
}

async function decide(version: string | null): Promise<Decision> {
  return JSON.parse(await link!.ask({ op: "decide", version })) as Decision;
}

async function meta(): Promise<Meta> {
  return JSON.parse(await link!.ask({ op: "meta" })) as Meta;
}

/** Corps d'une fonction Kotlin, accolades comptées. */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return "";
}

describe("WebView minimale (#907)", () => {
  test.skipIf(skip)("la majeure est lue dans les noms de version réels", async () => {
    expect(await decide("120.0.6099.230")).toMatchObject({ major: 120, supported: true });
    expect(await decide("100.0.4896.127")).toMatchObject({ major: 100, supported: true });
    expect(await decide("M100")).toMatchObject({ major: 100, supported: true });
    expect(await decide("99.0.4844.88")).toMatchObject({ major: 99, supported: false });
    expect(await decide("4.4.3")).toMatchObject({ major: 4, supported: false });
  });

  test.skipIf(skip)("le seuil est inclusif : 100 passe, 99 est refusée", async () => {
    expect((await decide("100")).supported).toBe(true);
    expect((await decide("101")).supported).toBe(true);
    expect((await decide("99")).supported).toBe(false);
  });

  test.skipIf(skip)("une version absente ou illisible est un refus explicite, pas un crash", async () => {
    for (const version of [null, "", "WebView", "sans chiffre"]) {
      const res = await decide(version);
      expect({ version, supported: res.supported, major: res.major }).toEqual({
        version,
        supported: false,
        major: null,
      });
      expect(res.message).toContain("version inconnue");
    }
  });

  test.skipIf(skip)("le message nomme le minimum, la version détectée et l'action", async () => {
    const res = await decide("96.0.4664.104");
    expect(res.supported).toBe(false);
    expect(res.message).toContain("Chromium 100");
    expect(res.message).toContain("Chromium 96");
    expect(res.message).toContain("Play Store");
    expect(res.message).toContain("relance");
    expect(res.message).toContain("Android 8.0 (API 26)");
  });

  test.skipIf(skip)("le seuil Android est celui du build, et la phrase cite le seuil WebView", async () => {
    const m = await meta();
    const minSdk = /minSdk\s*=\s*(\d+)/.exec(BUILD)?.[1];
    expect(minSdk).toBeDefined();
    expect(m.minAndroid).toBe(Number(minSdk));
    expect(m.minWebView).toBe(100);
    expect(m.statement).toContain("Android 8.0 (API 26)");
    expect(m.statement).toContain("Chromium 100");
  });

  test("la décision est PURE et compilée par la parité", () => {
    expect(SUPPORT).not.toMatch(/^import\s+android\./m);
    expect(SUPPORT).toContain("const val MIN_ANDROID_API = 26");
    expect(SUPPORT).toContain("const val MIN_WEBVIEW_MAJOR = 100");
    expect(read(join(ROOT, "tests/unit/fixtures/parity-sources.ts"))).toContain('"WebViewSupport.kt"');
  });

  test("l'activité refuse AVANT de construire la WebView", () => {
    expect(ACTIVITY).toContain("WebView.getCurrentWebViewPackage()?.versionName");
    const detection = ACTIVITY.indexOf("webViewSupport(currentWebViewVersion())");
    const shell = ACTIVITY.indexOf("NativeWebShell(this)");
    expect(detection).toBeGreaterThan(-1);
    expect(shell).toBeGreaterThan(-1);
    expect(detection).toBeLessThan(shell);
    expect(ACTIVITY).toContain("showUnsupportedWebView(support.installedMajor)");
  });

  test("l'écran de refus est natif, sans WebView ni chargement", () => {
    const fallback = body(ACTIVITY, "private fun showUnsupportedWebView(installedMajor: Int?)");
    expect(fallback).toContain("unsupportedWebViewMessage(installedMajor)");
    expect(fallback).toContain("setContentView");
    for (const forbidden of ["NativeWebShell", "loadUrl", "WebView("]) {
      expect(fallback).not.toContain(forbidden);
    }
    const current = ACTIVITY.slice(
      ACTIVITY.indexOf("private fun currentWebViewVersion"),
      ACTIVITY.indexOf("/** WebView trop ancienne"),
    );
    expect(current).toContain("WebView.getCurrentWebViewPackage()?.versionName");
    expect(current).toContain("catch (_: Exception)");
  });

  test("la politique est dans le README et dans l'aide de l'app", () => {
    for (const doc of [README, COMPATIBILITY]) {
      expect(doc).toMatch(/Chromium\s+100/);
      expect(doc).toContain("Android 8.0");
    }
    expect(HELP).toContain('id="aide-compatibilite"');
    expect(HELP).toContain("Configuration minimale");
    expect(HELP).toMatch(/Chromium 100/);
    expect(HELP).toContain("Android 8.0 (API 26)");
    expect(SETTINGS).toContain("WebView 100+");
  });
});

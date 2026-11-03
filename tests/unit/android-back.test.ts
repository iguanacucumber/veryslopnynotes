// Le retour matériel est décidé côté JS. La WebView n'est pas exécutable en
// CI : ce test garde le CÂBLAGE natif (callback -> JS -> sortie système) et la
// désactivation à l'accueil, qui préserve l'animation prédictive.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const read = (path: string) => codeOnly(readFileSync(path, "utf8"));
const shell = read(join(APP, "WebApp.kt"));
const bridge = read(join(APP, "VsnBridge.kt"));
const allowlist = read(join(APP, "BridgeCall.kt"));
const manifest = read(join(ROOT, "android/app/src/main/AndroidManifest.xml"));
const types = readFileSync(join(ROOT, "web/src/bridge/types.ts"), "utf8");

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

describe("unit android retour matériel (#914)", () => {
  test("le natif demande au JS et n'agit que si le JS n'a rien consommé", () => {
    const back = body(shell, "override fun handleOnBackPressed()");
    expect(back).toContain("evaluateJavascript(HARDWARE_BACK_JS)");
    expect(back).toContain('if (handled != "true") exitThroughSystemBack()');
    // Plus de navigation WebView concurrente : le JS est seul juge.
    expect(shell).not.toContain("canGoBack");
    expect(shell).not.toContain("goBack()");
  });

  test("le callback est désactivé à l'accueil pour garder le retour prédictif", () => {
    expect(shell).toContain("OnBackPressedCallback(false)");
    expect(shell).toContain("activity.onBackPressedDispatcher.addCallback(activity, backCallback)");
    const set = body(shell, "internal fun setBackAvailable(available: Boolean)");
    expect(set).toContain("backCallback.isEnabled = available");
    expect(body(shell, "private fun exitThroughSystemBack()")).toContain(
      "activity.onBackPressedDispatcher.onBackPressed()",
    );
    expect(manifest).toContain('android:enableOnBackInvokedCallback="true"');
  });

  test("l'état de retour traverse le pont sous un nom allowlisté des deux côtés", () => {
    expect(bridge).toContain('"app.backState" -> setBackState(p)');
    expect(body(bridge, "private fun setBackState(p: JSONObject)")).toContain(
      'onBackAvailable(p.optBoolean("available", false))',
    );
    expect(allowlist).toContain('"app.backState"');
    expect(types).toContain('"app.backState"');
  });

  test("la coquille branche la disponibilité sur le pont", () => {
    expect(shell).toContain("VsnBridge(activity, webView, { setBackAvailable(it) }, ::applyTextZoom)");
  });
});

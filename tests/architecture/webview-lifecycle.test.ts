// La WebView vit dans une activité : sans câblage du cycle de vie, ses timers
// JS continuent en arrière-plan et son cache RAM reste plein sous pression.
// Le comportement réel de `WebView` n'est pas exécutable hors appareil : ce test
// garde le CÂBLAGE (hooks Android -> coquille -> API WebView), et la preuve
// manuelle est décrite dans la PR (#869).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const ACTIVITY = codeOnly(readFileSync(join(APP, "MainActivity.kt"), "utf8"));
const SHELL = codeOnly(readFileSync(join(APP, "WebApp.kt"), "utf8"));

/** Corps d'une fonction Kotlin, accolades comptées (les signatures n'ont pas de `{`). */
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

describe("cycle de vie de la WebView (#869)", () => {
  test("l'activité transmet pause, reprise et pression mémoire à la coquille", () => {
    const pause = body(ACTIVITY, "override fun onPause()");
    expect(pause).toContain("webShell?.pause()");
    expect(pause).toContain("super.onPause()");

    const resume = body(ACTIVITY, "override fun onResume()");
    expect(resume).toContain("webShell?.resume()");
    expect(resume).toContain("super.onResume()");

    const trim = body(ACTIVITY, "override fun onTrimMemory(level: Int)");
    expect(trim).toContain("webShell?.trimMemory()");
    expect(trim).toContain("super.onTrimMemory(level)");
  });

  test("la coquille coupe ET reprend les timers JS", () => {
    const pause = body(SHELL, "fun pause()");
    expect(pause).toContain("webView.onPause()");
    expect(pause).toContain("webView.pauseTimers()");

    const resume = body(SHELL, "fun resume()");
    expect(resume).toContain("webView.resumeTimers()");
    expect(resume).toContain("webView.onResume()");
  });

  test("la pression mémoire vide le cache RAM, jamais l'état", () => {
    const trim = body(SHELL, "fun trimMemory()");
    expect(trim).toContain("webView.clearCache(false)");
    // Perdre l'historique, un formulaire ou la page rendrait le trim visible.
    for (const interdit of ["clearHistory(", "clearFormData(", "destroy()", "reload()", "loadUrl("]) {
      expect(trim).not.toContain(interdit);
    }
  });
});

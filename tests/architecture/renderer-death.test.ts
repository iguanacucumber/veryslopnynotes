// Une mort du rendu WebView (#866) ne se répare pas en réutilisant la vue :
// Android tue le process à la première réutilisation. Ce test garde le CÂBLAGE
// (callback -> destruction -> écran de reprise -> recréation au clic) ; la
// preuve sur appareil est décrite dans `android/README.md` et la PR.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

const ROOT = join(import.meta.dir, "..", "..");
const APP = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app");
const ACTIVITY = codeOnly(readFileSync(join(APP, "MainActivity.kt"), "utf8"));
const SHELL = codeOnly(readFileSync(join(APP, "WebApp.kt"), "utf8"));
const IDS = readFileSync(join(ROOT, "android/app/src/main/res/values/ids.xml"), "utf8");

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

describe("mort du rendu WebView (#866)", () => {
  test("onRenderProcessGone traite l'événement et rend true", () => {
    const gone = body(SHELL, "override fun onRenderProcessGone(");
    expect(gone).toContain("onRendererGone(this@NativeWebShell)");
    expect(gone).toContain("return true");
    // Une WebView morte ne se recharge JAMAIS sur place : crash garanti.
    expect(gone).not.toContain("reload()");
    expect(gone).not.toContain("loadUrl(");
  });

  test("la destruction retire la vue de la hiérarchie et abandonne son état", () => {
    const destroy = body(SHELL, "fun destroy()");
    expect(destroy).toContain("removeView(webView)");
    expect(destroy).toContain("webView.destroy()");
    expect(destroy).toContain("backCallback.remove()");
    expect(destroy).toContain("pageLoaded = false");
    // Double appel (callback puis onDestroy) : un seul destroy réel.
    expect(destroy).toContain("if (destroyed) return");
  });

  test("l'activité détruit la coquille, montre le retry, puis recrée au clic", () => {
    const gone = body(ACTIVITY, "private fun onRendererGone(");
    expect(gone).toContain("webShell = null");
    expect(gone).toContain("shell.destroy()");
    expect(gone).toContain("showRendererRetry()");

    const show = body(ACTIVITY, "private fun showRendererRetry()");
    expect(show).toContain('text = "Réessayer"');
    expect(show).toContain("R.id.renderer_retry");
    expect(show).toContain("L'interface s'est arrêtée.");

    const retry = body(ACTIVITY, "private fun retryRenderer()");
    expect(retry).toContain("mountShell(lastRoute)");
    expect(retry).not.toContain("reload()");
  });

  test("la recréation monte une coquille NEUVE, jamais l'ancienne", () => {
    const mount = body(ACTIVITY, "private fun mountShell(");
    expect(mount).toContain("NativeWebShell(this)");
    expect(mount).toContain("container.addView");
    expect(mount).toContain("shell.open(path)");
  });

  test("la route survit à la mort du rendu, même sans WebView", () => {
    const save = body(ACTIVITY, "override fun onSaveInstanceState(");
    expect(save).toContain("lastRoute");
    expect(save).toContain("ROUTE_STATE_KEY");
    // Plus de sortie précoce qui perdrait la route quand `webShell` est null.
    expect(save).not.toContain("?: return");
  });

  test("l'écran de reprise a un identifiant stable", () => {
    expect(IDS).toContain('<item name="renderer_retry" type="id" />');
  });
});

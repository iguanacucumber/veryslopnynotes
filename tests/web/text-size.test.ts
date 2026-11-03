// #942 : le web n'invente pas la taille — il propose 100/125/150, suit le
// réglage système par défaut, et laisse le natif persister le choix.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCall } from "../../web/src/bridge/mock";
import type { TextSizeState } from "../../web/src/bridge/types";
import {
  TEXT_SIZE_OPTIONS,
  effectiveTextZoom,
  isLargeText,
  parseTextSize,
  textZoomFromFontScale,
} from "../../web/src/lib/textScale";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

describe("taille du texte (#942)", () => {
  test("100/125/150 sont les choix explicites, SYSTEM reste le défaut", () => {
    expect(TEXT_SIZE_OPTIONS.map((option) => option.value)).toEqual(["SYSTEM", "100", "125", "150"]);
    expect(parseTextSize(undefined)).toBe("SYSTEM");
    expect(parseTextSize("inconnu")).toBe("SYSTEM");
    expect(parseTextSize(125)).toBe("125");
    expect(parseTextSize("150")).toBe("150");
  });

  test("le système est suivi jusqu'à 200 %, puis borné", () => {
    expect(textZoomFromFontScale(1)).toBe(100);
    expect(textZoomFromFontScale(1.25)).toBe(125);
    expect(textZoomFromFontScale(2)).toBe(200);
    expect(textZoomFromFontScale(2.4)).toBe(200);
    expect(textZoomFromFontScale(Number.NaN)).toBe(100);
    expect(effectiveTextZoom("SYSTEM", 2)).toBe(200);
    expect(effectiveTextZoom("125", 2)).toBe(125);
  });

  test("150 % et plus déclenchent le reflow, pas la coupure", () => {
    expect(isLargeText(100)).toBe(false);
    expect(isLargeText(125)).toBe(false);
    expect(isLargeText(150)).toBe(true);
    expect(isLargeText(200)).toBe(true);
    const css = source("styles/app.css");
    expect(css).toContain('html[data-text-zoom="large"]');
    expect(css).toContain("white-space: normal");
  });

  test("le choix est relu depuis le pont (persistance native)", async () => {
    const saved = await mockCall<TextSizeState & { ok: true }>("app.setTextSize", { size: "125" });
    expect(saved).toMatchObject({ ok: true, size: "125", zoom: 125 });
    const state = await mockCall<TextSizeState>("app.textSize", {});
    expect(state).toEqual({ size: "125", zoom: 125 });

    await mockCall("app.setTextSize", { size: "SYSTEM" });
    expect(await mockCall<TextSizeState>("app.textSize", {})).toEqual({ size: "SYSTEM", zoom: 100 });
  });

  test("le réglage expose un groupe ARIA et l'état pressé", () => {
    const card = source("features/settings/AppearanceCard.tsx");
    expect(card).toContain('role="group" aria-label="Taille du texte"');
    expect(card).toContain("aria-pressed={textSize === option.value}");
    expect(card).toContain("TEXT_SIZE_OPTIONS");
  });
});

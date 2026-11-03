// #942 : le zoom textuel suit le réglage Android ou un choix explicite, et
// reste borné pour la WebView. Le VRAI `core/TextScale.kt` est EXÉCUTÉ.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "TextScaleMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function zoom(preference: string | null, fontScale: number): Promise<number> {
  const res = JSON.parse(await link!.ask({ op: "zoom", preference, fontScale })) as { zoom: number };
  return res.zoom;
}

async function parse(raw: string | null): Promise<string | null> {
  const res = JSON.parse(await link!.ask({ op: "parse", raw })) as { value: string | null };
  return res.value;
}

async function wire(raw: string | null): Promise<string> {
  const res = JSON.parse(await link!.ask({ op: "wire", raw })) as { value: string };
  return res.value;
}

describe("taille du texte (#942)", () => {
  test.skipIf(skip)("le système est suivi, y compris à 200 %", async () => {
    expect(await zoom("SYSTEM", 1)).toBe(100);
    expect(await zoom("SYSTEM", 1.25)).toBe(125);
    expect(await zoom("SYSTEM", 1.5)).toBe(150);
    expect(await zoom("SYSTEM", 2)).toBe(200);
  });

  test.skipIf(skip)("un choix explicite prime sur le système", async () => {
    expect(await zoom("100", 2)).toBe(100);
    expect(await zoom("125", 2)).toBe(125);
    expect(await zoom("150", 2)).toBe(150);
  });

  test.skipIf(skip)("la valeur stockée inconnue retombe sur le système", async () => {
    expect(await parse("SYSTEM")).toBe("SYSTEM");
    expect(await parse("system")).toBe("SYSTEM");
    expect(await parse("125")).toBe("125");
    expect(await parse("999")).toBeNull();
    expect(await parse("système")).toBeNull();
    expect(await wire(null)).toBe("SYSTEM");
    expect(await wire("inconnu")).toBe("SYSTEM");
    expect(await wire("150")).toBe("150");
  });

  test.skipIf(skip)("le zoom système reste borné pour la WebView", async () => {
    expect(await zoom("SYSTEM", 0.2)).toBe(50);
    expect(await zoom("SYSTEM", 2.4)).toBe(200);
  });
});

// PRV-12 (#856) : l'appairage exige une attestation visible AVANT la session.
// Le test vérifie les trois promesses : bloqué sans case, autorisé avec, et la
// copie réellement rendue (compte personnel + autorisation scolaire ou
// parentale + aucune écriture sans confirmation).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PairingAuthorization } from "../../web/src/features/pairing/Authorization";
import { pairingAllowed } from "../../web/src/features/pairing/model";

const ROOT = join(import.meta.dir, "..", "..");
const SCREEN = readFileSync(
  join(ROOT, "web", "src", "features", "pairing", "PairingScreen.tsx"),
  "utf8",
);

function renderAuthorization(checked: boolean, error = ""): string {
  return renderToStaticMarkup(
    createElement(PairingAuthorization, { checked, error, onChange: () => undefined }),
  );
}

describe("appairage — attestation d’autorisation scolaire (#856)", () => {
  test("aucun appairage avant l’attestation, appairage possible après", () => {
    expect(pairingAllowed(true, false)).toBe(false);
    expect(pairingAllowed(false, true)).toBe(false);
    expect(pairingAllowed(false, false)).toBe(false);
    expect(pairingAllowed(true, true)).toBe(true);
  });

  test("la copie rendue nomme le compte personnel, l’autorisation et l’absence d’écriture", () => {
    const html = renderAuthorization(false);
    expect(html).toContain("compte personnel");
    expect(html).toContain("autorisation de mon établissement ou de mes parents");
    expect(html).toContain("aucun appairage n’est lancé");
    expect(html).toContain("n’écrit aucune donnée");
  });

  test("le champ est une case étiquetée, décrite et non cochée par défaut", () => {
    const html = renderAuthorization(false);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('id="pairing-attestation"');
    expect(html).toContain('for="pairing-attestation"');
    expect(html).toContain('aria-describedby="pairing-attestation-help"');
    expect(html).toContain('id="pairing-attestation-help"');
    expect(html).toContain('aria-required="true"');
    expect(html).not.toContain("checked");
  });

  test("une erreur décrit la case et s’annonce", () => {
    const html = renderAuthorization(false, "Coche l’attestation avant d’ouvrir la session.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("pairing-attestation-error");
    expect(html).toContain("Coche l’attestation");
    expect(html).toContain('role="alert"');
  });

  test("l’écran bloque le bouton et le submit sur l’attestation", () => {
    expect(SCREEN).toContain('import { PairingAuthorization } from "./Authorization";');
    expect(SCREEN).toContain("const ready = pairingAllowed(qrReady, attested);");
    expect(SCREEN).toContain(
      "disabled={!ready || submitting || scanning || exportState.exporting}",
    );
    expect(SCREEN).toContain("<PairingAuthorization");
    expect(SCREEN.indexOf("<PairingAuthorization")).toBeLessThan(
      SCREEN.indexOf('type="submit"'),
    );

    const submit = SCREEN.indexOf("async function submit(");
    const guard = SCREEN.indexOf("if (!attested)", submit);
    const write = SCREEN.indexOf("bridge.pair(", submit);
    expect(guard).toBeGreaterThan(submit);
    expect(write).toBeGreaterThan(guard);
    expect(SCREEN).toContain("attestationRef.current?.focus();");
  });
});

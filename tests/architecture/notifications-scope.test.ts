// Décision #832 : aucun rappel, compte élève uniquement. Une copie qui
// promettrait une notification ou un accès parent rougit ici, avant la PR.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ADR = read("docs/adr/010-notifications-and-account-scope.md");
const README = read("README.md");
const PRODUCT = read("docs/PRODUCT.md");

describe("ADR-010 — rappels et périmètre des comptes (#832)", () => {
  test("l'ADR est accepté et complète ADR-006", () => {
    expect(ADR).toMatch(/^- Statut : accepté/m);
    expect(ADR).toContain("006-no-notifications.md");
  });

  test("la décision dit : aucun rappel, compte élève uniquement, parent hors périmètre", () => {
    expect(ADR).toMatch(/aucun rappel/i);
    expect(ADR).toMatch(/compte élève uniquement/i);
    expect(ADR).toMatch(/comptes parent sont hors périmètre/i);
  });

  test("README et PRODUCT portent la même limite", () => {
    expect(README).toMatch(/pas de rappels/i);
    expect(README).toMatch(/compte élève/i);
    expect(PRODUCT).toMatch(/sans rappel ni notification/i);
    expect(PRODUCT).toMatch(/comptes parent hors\s+périmètre/i);
    expect(PRODUCT).toContain("adr/010-notifications-and-account-scope.md");
  });

  test("l'aide et le profil ne promettent ni rappel ni bascule parent", () => {
    const help = read("web/src/features/help/HelpScreen.tsx");
    expect(help).toContain('id="aide-rappels"');
    expect(help).toContain("aucun rappel");
    expect(help).toContain("comptes parent sont hors périmètre");
    expect(read("web/src/features/profile/ProfileScreen.tsx")).toContain("Lecture seule");
  });

  test("l'app ne déclare pas la permission de notifier", () => {
    expect(read("android/app/src/main/AndroidManifest.xml")).not.toContain("POST_NOTIFICATIONS");
  });
});

// La borne de `periodName` doit être la même dans le contrat TS (`models.ts`),
// le noyau Kotlin (`UserProfileRules`) et le web (`profile/model.ts`) : le web
// bornait à 64 quand le natif publiait jusqu'à 100, perdant le profil.
// Le test compile le vrai `core/UserProfile.kt` ; outillage absent = SKIP
// BRUYANT (jamais un faux vert), échec de compilation = défaut.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isUserInfo, USER_PERIOD_NAME_MAX_CHARS } from "../../shared/contracts/models";
import { parseProfilePayload } from "../../web/src/features/profile/model";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { payloadsSource } from "./fixtures/payload-sources";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "ProfileParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

/** Borne du contrat partagé : la référence des trois côtés. */
const BOUND = USER_PERIOD_NAME_MAX_CHARS;

function contractAccepts(periodName: string): boolean {
  return isUserInfo({ accountId: "acc-fake-1", displayName: "Nom Exemple", periodName });
}

function webAccepts(periodName: string): boolean {
  const payload = JSON.stringify({
    user: { accountId: "acc-fake-1", displayName: "Nom Exemple", periodName },
  });
  return parseProfilePayload(payload) !== null;
}

describe("borne de periodName (#420) — contrat TS <-> natif <-> web", () => {
  test.skipIf(skip)("la borne du noyau est celle du contrat partagé", async () => {
    const res = JSON.parse(await ask({ op: "periodNameMax" })) as { max: number };
    expect(res.max).toBe(BOUND);
  });

  test.skipIf(skip)("même verdict des trois côtés autour de la borne", async () => {
    for (const length of [BOUND - 1, BOUND, BOUND + 1]) {
      const periodName = "P".repeat(length);
      const expected = length <= BOUND;
      const kotlin = (JSON.parse(await ask({ op: "profileValid", periodName })) as { ok: boolean }).ok;
      expect({ length, kotlin }).toEqual({ length, kotlin: expected });
      expect({ length, contract: contractAccepts(periodName) }).toEqual({ length, contract: expected });
      expect({ length, web: webAccepts(periodName) }).toEqual({ length, web: expected });
    }
  });

  test("le libellé long du natif survit au web (pas de profil perdu)", () => {
    const periodName = "Trimestre 1 — année scolaire 2026-2027";
    expect(periodName.length).toBeLessThanOrEqual(BOUND);
    expect(webAccepts(periodName)).toBe(true);
    expect(contractAccepts(periodName)).toBe(true);
  });

  test("une seule borne : le natif publie avec celle du noyau, le web avec celle du contrat", () => {
    // Le payload natif : la borne du noyau, pas un littéral qui pourrait diverger.
    const payloads = payloadsSource();
    expect(payloads).toContain("boundedCp(it.name, UserProfileRules.MAX_PERIOD_NAME)");
    expect(payloads).not.toMatch(/periodName",\s*boundedCp\([^)]*,\s*\d+\)/);
    // Le web : la borne du contrat, importée — jamais une constante locale.
    const web = readFileSync(join(ROOT, "web", "src", "features", "profile", "model.ts"), "utf8");
    expect(web).toContain("USER_PERIOD_NAME_MAX_CHARS");
    expect(web).not.toMatch(/periodName\.length\s*>\s*\d+/);
    // Le noyau : la borne dédiée, pas celle des noms.
    const core = readFileSync(join(CORE, "UserProfile.kt"), "utf8");
    expect(core).toContain("MAX_PERIOD_NAME");
    expect(core).not.toMatch(/periodName\.length\s*>\s*MAX_NAME/);
  });
});

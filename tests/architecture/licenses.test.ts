// Les notices OFL (SN Pro) et MIT (Papicons) sont redistribuées avec l'APK :
// Vite copie `web/public/` dans `assets/web/`, à côté des TTF et des icônes.
// Un asset embarqué sans sa notice est une redistribution sans licence.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfig } from "vite";

const ROOT = join(import.meta.dir, "..", "..");
const LICENSES = join(ROOT, "web", "public", "licenses");
const read = (name: string) => readFileSync(join(LICENSES, name), "utf8");

describe("notices de licence embarquées", () => {
  test("SN Pro : la notice OFL accompagne les six graisses", () => {
    const notice = read("SN-PRO-OFL.txt");
    expect(notice).toContain("The SN Pro Project Authors");
    expect(notice).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  test("Papicons : la notice MIT accompagne les icônes", () => {
    const notice = read("PAPICONS-MIT.txt");
    expect(notice).toContain("MIT License");
    expect(notice).toContain("Association Papillon");
  });

  test("Vite copie bien ce dossier dans les assets de l'APK", async () => {
    const config = await resolveConfig(
      { configFile: join(ROOT, "web", "vite.config.ts"), root: join(ROOT, "web") },
      "build",
    );
    expect(config.publicDir).toBe(join(ROOT, "web", "public"));
    expect(resolve(join(ROOT, "web"), config.build.outDir)).toBe(
      join(ROOT, "android", "app", "src", "main", "assets", "web"),
    );
    expect(readdirSync(LICENSES).sort()).toEqual(["PAPICONS-MIT.txt", "SN-PRO-OFL.txt"]);
  });
});

// Le thème doit être posé AVANT React : un effet après montage laissait un
// écran blanc sur un thème sombre mémorisé. Le script est un fichier classique
// public, donc on le rejoue ici dans un DOM factice.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..", "..", "web");
const BOOTSTRAP = readFileSync(join(WEB, "public", "theme-bootstrap.js"), "utf8");
const INDEX = readFileSync(join(WEB, "index.html"), "utf8");

function run(stored: string | null, systemDark: boolean, storageThrows = false) {
  const root = { dataset: {} as Record<string, string> };
  const meta = {
    content: "",
    setAttribute(_name: string, value: string) {
      this.content = value;
    },
  };
  const document = { documentElement: root, querySelector: () => meta };
  const localStorage = {
    getItem: () => {
      if (storageThrows) throw new Error("storage indisponible");
      return stored;
    },
  };
  const matchMedia = () => ({ matches: systemDark });
  new Function("localStorage", "matchMedia", "document", BOOTSTRAP)(
    localStorage,
    matchMedia,
    document,
  );
  return { theme: root.dataset["theme"], color: meta.content };
}

describe("bootstrap du thème", () => {
  test("un thème sombre mémorisé ne passe jamais par le clair", () => {
    expect(run("DARK", false)).toEqual({ theme: "dark", color: "#000000" });
    expect(run("DARK", true)).toEqual({ theme: "dark", color: "#000000" });
  });

  test("un thème clair mémorisé ignore le système", () => {
    expect(run("LIGHT", true)).toEqual({ theme: "light", color: "#ffffff" });
  });

  test("SYSTEM et une valeur absente suivent la préférence système", () => {
    expect(run("SYSTEM", true)).toEqual({ theme: "dark", color: "#000000" });
    expect(run("SYSTEM", false)).toEqual({ theme: "light", color: "#ffffff" });
    expect(run(null, true)).toEqual({ theme: "dark", color: "#000000" });
    expect(run("inconnu", true)).toEqual({ theme: "dark", color: "#000000" });
  });

  test("un stockage indisponible retombe sur le système, sans casser le rendu", () => {
    expect(run(null, true, true)).toEqual({ theme: "dark", color: "#000000" });
  });

  test("le script est chargé dans le head, avant le module de l'app", () => {
    const script = INDEX.indexOf('src="./theme-bootstrap.js"');
    const module = INDEX.indexOf('type="module"');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(module);
    expect(INDEX).toContain('<meta name="theme-color"');
  });
});

// #423 : le pont factice (`web/src/bridge/mock.ts`) est un artefact de
// DÉVELOPPEMENT. Le build de production ne doit pas l'embarquer : sinon une
// WebView sans pont natif sert une école fictive complète (faux profil,
// fausses notes) et `session.restore` répond « restored » — l'écran
// d'appairage n'apparaît jamais.
//
// Deux garde-fous, tous deux automatiques :
//  1. le client n'importe le factice que dans une branche de développement
//     (pas d'import statique : le module n'entre jamais dans le graphe) ;
//  2. le bundle réellement produit par Vite ne contient AUCUN marqueur du
//     factice (le build est rejoué ici, dans un dossier jetable).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const CLIENT = join(ROOT, "web/src/bridge/client.ts");
const VITE = join(ROOT, "node_modules/.bin/vite");

/**
 * Marqueurs du module factice : des CHAÎNES du code source, donc présentes
 * dans le bundle s'il y entre (le minificateur ne touche pas aux littéraux).
 * Chacune est introuvable ailleurs dans l'app.
 */
const MARQUEURS = ["FAZZARI", "méthode factice inconnue", "demo.school.invalid"];

/** Tous les fichiers d'un dossier (récursif). */
function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const entree of readdirSync(dir)) {
    const chemin = join(dir, entree);
    if (statSync(chemin).isDirectory()) out.push(...fichiers(chemin));
    else out.push(chemin);
  }
  return out;
}

describe("le pont factice reste un artefact de développement", () => {
  test("le client n'importe le factice que dans une branche de développement", () => {
    const client = readFileSync(CLIENT, "utf8");
    // Pas d'import STATIQUE : le module factice entrerait dans le graphe du
    // build, donc dans le bundle livré à l'APK.
    expect(client).not.toMatch(/from\s+"\.\/mock"/);
    // L'unique référence au factice est derrière la garde de développement.
    const corps = /async function devCall[\s\S]*?\n}/.exec(client)?.[0] ?? "";
    expect(corps).toContain("import.meta.env.DEV");
    expect(corps).toContain('import("./mock")');
    expect(corps.indexOf("import.meta.env.DEV")).toBeLessThan(
      corps.indexOf('import("./mock")'),
    );
  });

  test("le bundle de production n'embarque aucun marqueur du factice", () => {
    // Le VRAI build (pas une relecture de source) : c'est l'artefact livré
    // dans l'APK qui est contrôlé, dossier jetable pour ne pas marcher sur
    // les assets de l'APK pendant qu'un autre build tourne.
    const sortie = mkdtempSync(join(tmpdir(), "vsn-web-423-"));
    const build = Bun.spawnSync(
      [VITE, "build", "--config", "web/vite.config.ts", "--outDir", sortie, "--emptyOutDir"],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const journal =
      new TextDecoder().decode(build.stdout) + new TextDecoder().decode(build.stderr);
    if (build.exitCode !== 0) {
      throw new Error(`build web ÉCHOUÉ :\n${journal}`);
    }
    const produits = fichiers(sortie);
    expect(produits.length).toBeGreaterThan(0);
    for (const fichier of produits) {
      const contenu = readFileSync(fichier, "utf8");
      for (const marqueur of MARQUEURS) {
        expect(contenu).not.toContain(marqueur);
      }
    }
    rmSync(sortie, { recursive: true, force: true });
  });
});

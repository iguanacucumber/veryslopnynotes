// Le pont factice (`web/src/bridge/mock.ts`) est un artefact de DÉVELOPPEMENT :
// livré en production, une WebView sans pont natif servirait une école fictive
// et `session.restore` répondrait « restored ».
//
// Le bundle vérifié est l'artefact RÉEL de l'APK, construit UNE fois par le gate
// et stable pendant l'étape architecture ; le filet du build (durée + réessai)
// vit dans `agents/runtime/build-web.ts`.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CLIENT = join(import.meta.dir, "..", "..", "web", "src", "bridge", "client.ts");

/** Bundle RÉEL embarqué dans l'APK (sortie Vite, `web/vite.config.ts`). */
const BUNDLE = join(import.meta.dir, "..", "..", "android", "app", "src", "main", "assets", "web");

/**
 * Marqueurs du module factice : des CHAÎNES du source, que le minificateur
 * préserve, et introuvables ailleurs dans l'app.
 */
const MARQUEURS = ["DUPONT", "méthode factice inconnue", "demo.school.invalid"];

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
    // Import STATIQUE interdit : le module factice entrerait dans le graphe du
    // build, donc dans le bundle livré à l'APK.
    expect(client).not.toMatch(/from\s+"\.\/mock"/);
    const corps = /async function devCall[\s\S]*?\n}/.exec(client)?.[0] ?? "";
    expect(corps).toContain("import.meta.env.DEV");
    expect(corps).toContain('import("./mock")');
    expect(corps.indexOf("import.meta.env.DEV")).toBeLessThan(
      corps.indexOf('import("./mock")'),
    );
  });

  test(
    "le bundle livré à l'APK n'embarque aucun marqueur du factice",
    () => {
      // Bundle absent ou vide = rien de vérifié : ÉCHEC explicite qui nomme la
      // commande, jamais un vert vacuement vrai.
      if (!existsSync(BUNDLE)) {
        throw new Error(
          `bundle web ABSENT (${BUNDLE}) — lancer « make web-build » avant le test d'architecture.`,
        );
      }
      const produits = fichiers(BUNDLE);
      if (produits.length === 0) {
        throw new Error(
          `bundle web VIDE (${BUNDLE}) — « make web-build » n'a rien produit.`,
        );
      }
      for (const fichier of produits) {
        const contenu = readFileSync(fichier, "utf8");
        for (const marqueur of MARQUEURS) {
          expect(contenu).not.toContain(marqueur);
        }
      }
    },
    // Lecture complète du bundle : plafond explicite (le build est hors de ce test).
    60_000,
  );
});

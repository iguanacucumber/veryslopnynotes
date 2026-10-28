// #423 : le pont factice (`web/src/bridge/mock.ts`) est un artefact de
// DÉVELOPPEMENT. Le build de production ne doit pas l'embarquer : sinon une
// WebView sans pont natif sert une école fictive complète (faux profil,
// fausses notes) et `session.restore` répond « restored » — l'écran
// d'appairage n'apparaît jamais.
//
// Deux garde-fous, tous deux automatiques :
//  1. le client n'importe le factice que dans une branche de développement
//     (pas d'import statique : le module n'entre jamais dans le graphe) ;
//  2. le bundle livré à l'APK ne contient AUCUN marqueur du factice.
//
// #654 : le build n'est plus REJOUÉ ici dans un dossier jetable — le gate
// construit le bundle UNE fois (`web-build`, tiré par `architecture` AVANT
// `architecture-test`), et ce test vérifie l'artefact RÉEL qui part dans
// l'APK (`android/app/src/main/assets/web/`). Un seul Vite par `make check`,
// et la preuve porte sur le fichier livré, pas sur une copie. Sabotage
// vérifié en PR #654 : un marqueur du factice injecté dans le bundle fait
// échouer `make check`. L'artefact est généré (gitignoré) mais STABLE pendant
// l'étape architecture — web-build est terminé, personne d'autre ne touche le
// dossier — donc un parcours local ne subit plus la course #418.
//
// #516 : le build passe par `agents/runtime/build-web.ts` (plafond de durée +
// UN réessai si le processus meurt) — ce filet vit dans le HELPER, éprouvé
// par `tests/unit/build-web.test.ts` ; ce test n'en dépend plus, il lit le
// résultat.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CLIENT = join(import.meta.dir, "..", "..", "web", "src", "bridge", "client.ts");

/** Le bundle RÉEL de l'APK : la sortie du build Vite (défaut de
 *  `web/vite.config.ts`), celui que Gradle embarque. */
const BUNDLE = join(import.meta.dir, "..", "..", "android", "app", "src", "main", "assets", "web");

/**
 * Marqueurs du module factice : des CHAÎNES du code source, donc présentes
 * dans le bundle s'il y entre (le minificateur ne touche pas aux littéraux).
 * Chacune est introuvable ailleurs dans l'app.
 */
const MARQUEURS = ["DUPONT", "méthode factice inconnue", "demo.school.invalid"];

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

  test(
    "le bundle livré à l'APK n'embarque aucun marqueur du factice",
    () => {
      // L'artefact RÉEL, construit UNE fois par le gate (`make architecture`
      // → web-build puis ce test). Absent ou vide = rien de vérifié : ÉCHEC
      // explicite qui nomme la commande, jamais un vert vacuement vrai
      // (même règle que #532 pour les scanners).
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
    // Le bundle peut être gros : la lecture complète reste bien sous le
    // défaut de 5 s de `bun test`, mais le plafond explicite garde un
    // respirateur (le build lui-même est hors de ce test depuis #654).
    60_000,
  );
});

// L'image Docker du scraper installe Chromium AU BUILD, et son absence répond
// 501 (« scraper sans navigateur »), jamais 500.
// Deux garanties : le mapping d'erreur et l'analyse statique du Dockerfile.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../server/infrastructure/http";
import { ScrapeManualsError } from "../../server/infrastructure/manuals-scrape";

const ROOT = join(import.meta.dir, "..", "..");

/** Corps de scrape synthétique (aucun credential réel, aucun réseau). */
const BODY = {
  platform: "exemple",
  startUrl: "https://manuels.example.invalid/6e/maths",
};

const post = () =>
  new Request("http://127.0.0.1/v1/manuals/scrape", {
    method: "POST",
    body: JSON.stringify(BODY),
  });

/** App dont le scraper lève toujours la même erreur. */
function appThrowing(err: unknown) {
  return createApp({
    scrape: async () => {
      throw err;
    },
  });
}

/**
 * Messages RÉELS de Playwright 1.64.1 (recopiés du runtime, pas inventés) :
 * le binaire absent (image sans `playwright install`) et les libs système
 * absentes (image sans `--with-deps`).
 */
const MISSING_BROWSER_MESSAGES = [
  "launch: Executable doesn't exist at /ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell\n" +
    "╔════════════════════════════════════════════════════════════╗\n" +
    "║ Looks like Playwright was just installed or updated.       ║\n" +
    "║ Please run the following command to download new browsers: ║\n" +
    "║                                                            ║\n" +
    "║     npx playwright install                                 ║\n" +
    "║                                                            ║\n" +
    "║ <3 Playwright Team                                         ║\n" +
    "╚════════════════════════════════════════════════════════════╝",
  "Host system is missing dependencies to run browsers.\n\nPlease install them with the following command:\n\n    npx playwright install-deps",
  // Message interne du scraper (module `playwright` absent).
  "Playwright non installé — e2e manuals skippé (aucune dép ajoutée v1)",
];

describe("#374 — navigateur Playwright absent", () => {
  test("erreur navigateur absent = 501 « scraper sans navigateur », jamais 500", async () => {
    for (const message of MISSING_BROWSER_MESSAGES) {
      const res = await appThrowing(new Error(message)).handler(post());
      expect(res.status).toBe(501);
      expect(await res.json()).toEqual({
        error: { code: "not_implemented", message: "scraper sans navigateur" },
      });
    }
  });

  test("le mapping ne mange pas les autres échecs (500 inattendu, 502 portail)", async () => {
    const broken = await appThrowing(new Error("panne interne")).handler(post());
    expect(broken.status).toBe(500);
    const school = await appThrowing(new ScrapeManualsError("réponse HTTP 500 sur exemple")).handler(
      post(),
    );
    expect(school.status).toBe(502);
  });
});

describe("#374 — image Docker : le navigateur est installé au build", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile.server"), "utf8");
  const lines = dockerfile.split("\n");

  test("une instruction RUN installe le navigateur Playwright (chromium)", () => {
    const installLines = lines.filter(
      (l) => /^\s*RUN\b/.test(l) && /playwright\s+install/.test(l),
    );
    expect(installLines.length).toBeGreaterThan(0);
    // Le navigateur demandé est bien chromium (le scraper n'utilise que ça).
    expect(installLines.join("\n")).toMatch(/chromium/);
  });

  test("pas de téléchargement au runtime (le CMD ne lance pas `playwright install`)", () => {
    const cmd = lines.filter((l) => /^\s*CMD\b/.test(l)).join("\n");
    expect(cmd).not.toMatch(/playwright\s+install/);
    expect(cmd).toContain("http.ts");
  });

  test("si le chemin des navigateurs est fixé, il est partagé build/runtime", () => {
    const envIndex = lines.findIndex((l) => /^\s*ENV\s+PLAYWRIGHT_BROWSERS_PATH=/.test(l));
    const installIndex = lines.findIndex(
      (l) => /^\s*RUN\b/.test(l) && /playwright\s+install/.test(l),
    );
    if (envIndex < 0) return; // chemin par défaut : rien à partager.
    // L'ENV précède l'installation et reste dans l'image finale.
    expect(envIndex).toBeLessThan(installIndex);
    expect(dockerfile).toMatch(/PLAYWRIGHT_BROWSERS_PATH=/);
  });

  test("l'image ne déclare aucun secret en ENV (I8)", () => {
    const envVars = lines
      .filter((l) => /^\s*ENV\s/.test(l))
      .flatMap((l) => l.replace(/^\s*ENV\s+/, "").split(/\s+/))
      .map((pair) => pair.split("=")[0] ?? "")
      .filter(Boolean);
    // Aucun credential : ni clé, ni mot de passe, ni jeton.
    for (const name of envVars) {
      expect(name).not.toMatch(/KEY|TOKEN|SECRET|PASS|CREDENTIAL/i);
    }
  });
});

// L'image tournait en ROOT, en clair, sur toutes les interfaces : point d'entrée
// sans auth (I8). TLS obligatoire et exposition 127.0.0.1 par défaut, comme runServer.
describe("#533 — l'image Docker n'est ni root ni en clair", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile.server"), "utf8");
  const lines = dockerfile.split("\n");
  /** Les directives `USER` de l'image (la dernière est celle qui s'applique). */
  const users = lines
    .filter((l) => /^\s*USER\b/.test(l))
    .map((l) => l.replace(/^\s*USER\s+/, "").trim());
  /** Le CMD de l'image (forme exec ou shell). */
  const cmd = lines.filter((l) => /^\s*CMD\b/.test(l)).join("\n");

  test("elle tourne sous un utilisateur NON privilégié", () => {
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user).not.toBe("root");
      // uid 0 = root, écrit en toutes lettres.
      expect(user).not.toMatch(/^0\b/);
    }
  });

  test("le jar de session appartient à cet utilisateur (pas de fichier root)", () => {
    const user = users.at(-1)!;
    // Le répertoire du jar appartient au scraper, sinon un non-root ne peut pas persister.
    expect(dockerfile).toContain("playwright/.auth");
    expect(dockerfile).toMatch(new RegExp(`chown[^\\n]*${user}`));
  });

  test("le TLS est obligatoire : pas de repli en clair (le service est sans auth, I8)", () => {
    expect(cmd).toContain("TLS_CERT_FILE");
    expect(cmd).toContain("TLS_KEY_FILE");
    // Le garde REFUSE (exit 1) : sans couple, le service ne démarre pas.
    expect(cmd).toMatch(/exit 1/);
  });

  test("elle ne force pas HOST : l'exposition est une décision explicite", () => {
    // Exposition = choix de l'opérateur, sur un réseau de confiance (le service est sans auth).
    expect(dockerfile).not.toMatch(/^\s*ENV\s+HOST\s*=/m);
  });

  test("le HOME est celui de l'utilisateur (sinon Chromium n'écrit rien)", () => {
    // Sans HOME explicite, le profil Chromium et le jar seraient inaccessibles.
    const home = /^\s*ENV\s+HOME=(\S+)/m.exec(dockerfile)?.[1];
    expect(home).toBeTruthy();
    expect(home).toMatch(/^\/home\//);
  });
});

// Smoke Playwright du frontend : sert le build local et vérifie toutes les
// routes dans Chromium. Hors `make check` (un navigateur n'est pas requis pour
// vérifier le code) ; `make web-smoke` le lance explicitement.
//
// Le bundle de PRODUCTION n'embarque plus le pont factice (#423) : le smoke
// le fournit lui-même, en exécutant le MÊME module `web/src/bridge/mock.ts`
// côté Node (`page.exposeFunction`). Les écrans sont donc servis par les
// données de démonstration, sans réintroduire le factice dans l'APK.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { mockCall } from "../../web/src/bridge/mock";
import { SMOKE_ROUTES } from "../../web/src/smoke-routes";
import { bound } from "./output";

const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 4173;
const URL_BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = "/tmp/opencode/web-shots";

/** Liste bornée : 10 lignes max, une par message, le reste dans le log
 *  complet (`node_modules/.cache/gate-logs/<step>.log`). */
function afficherErreurs(titre: string, step: string, messages: readonly string[]): void {
  const lignes = messages.flatMap((m) => m.split("\n")).filter((l) => l.trim() !== "");
  console.error(titre);
  for (const l of bound(ROOT, step, lignes)) console.error("  " + l);
}

/**
 * Pont factice injecté dans la page : il parle le protocole natif
 * (`call(requestId, method, paramsJson)` + `__vsnResolve`/`__vsnReject`) et
 * délègue au module factice, exécuté côté Node.
 */
const BRIDGE_FACTICE = `
  window.VSN = {
    call(requestId, method, paramsJson) {
      let params = {};
      try { params = paramsJson ? JSON.parse(paramsJson) : {}; } catch (e) { params = {}; }
      window.__vsnMock(method, params).then(
        (value) => window.__vsnResolve?.(requestId, JSON.stringify(value ?? null)),
        (error) => window.__vsnReject?.(requestId, JSON.stringify({ code: "unknown", message: String(error) })),
      );
    },
  };
`;

const preview = Bun.spawn(["bunx", "vite", "preview", "--config", "web/vite.config.ts", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  stdout: "pipe",
  stderr: "pipe",
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(URL_BASE);
      if (res.ok) return;
    } catch {
      // pas encore prêt
    }
    await Bun.sleep(250);
  }
  throw new Error("vite preview ne répond pas");
}

let code = 0;
try {
  mkdirSync(SHOTS, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // Le pont factice, servi par le module `web/src/bridge/mock.ts` (côté Node).
  await page.exposeFunction("__vsnMock", (method: string, params: unknown) => mockCall(method, params));
  await page.addInitScript(BRIDGE_FACTICE);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  let firstRoute = true;
  for (const [name, route] of SMOKE_ROUTES) {
    await page.goto(`${URL_BASE}#${route}`, { waitUntil: "networkidle" });
    await page.locator("h1, h2, strong").first().waitFor();
    // Les écrans chargent via le pont factice : attendre la fin des spinners
    // avant de capturer, sinon la preuve montre un état transitoire.
    await page
      .waitForFunction(() => !document.querySelector(".spinner"), null, { timeout: 5000 })
      .catch(() => undefined);
    await page.waitForTimeout(120);
    // Accessibilité (#625) : une seule cible `main`, langue déclarée, et le
    // lien d'évitement réellement atteint par le PREMIER Tab puis activé au
    // clavier. Au tout premier chargement, le document démarre sans focus
    // déplacé : on tabule tel quel. Après une navigation SPA, le titre de la
    // coquille reprend le focus pour annoncer la page ; on le retire avant de
    // tabuler pour mesurer l'ordre de tabulation DEPUIS LE DÉBUT DU DOCUMENT,
    // comme au chargement.
    const mainCount = await page.locator("main").count();
    const mainTarget =
      mainCount === 1
        ? await page.locator("main").first().evaluate((element) => ({
            id: element.id,
            tabIndex: element.getAttribute("tabindex"),
          }))
        : { id: "", tabIndex: null };
    if (mainCount !== 1 || mainTarget.id !== "main" || mainTarget.tabIndex !== "-1") {
      console.error(
        `web-smoke : cible main invalide sur ${route} (${mainCount} main, id="${mainTarget.id}", tabindex="${mainTarget.tabIndex}")`,
      );
      code = 1;
    }
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== "fr") {
      console.error(`web-smoke : langue du document "${lang}" sur ${route}, attendu "fr"`);
      code = 1;
    }
    if (!firstRoute) {
      await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
        // Le point de départ de la tabulation reste sinon sur le titre qui
        // vient d'être focalisé : on le ramène au corps du document (comme
        // après un chargement), sans l'ajouter à l'ordre de tabulation.
        document.body.tabIndex = -1;
        document.body.focus();
      });
    }
    firstRoute = false;
    await page.keyboard.press("Tab");
    const skipReached = await page
      .waitForFunction(
        () => {
          const element = document.querySelector<HTMLElement>(".skip-link");
          if (!element || document.activeElement !== element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight + 1
          );
        },
        null,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!skipReached) {
      console.error(`web-smoke : le lien d'évitement n'est pas le premier Tab visible sur ${route}`);
      code = 1;
    } else {
      // Le bouton doit rendre le focus au main. On presse Entrée seulement
      // quand il a bien reçu le focus (sinon on ne teste pas ce qu'on croit).
      await page.keyboard.press("Enter");
      const focused = await page
        .waitForFunction(() => document.activeElement?.id === "main", null, { timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (!focused) {
        console.error(`web-smoke : l'activation du lien d'évitement ne focalise pas #main sur ${route}`);
        code = 1;
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (overflow) {
      console.error(`web-smoke : débordement horizontal sur ${route}`);
      code = 1;
    }
    if (route === "/canteen") {
      const cards = await page.locator("main article.card").count();
      const text = await page.locator("main").innerText();
      if (cards < 1 || !text.includes("Déjeuner") || !text.includes("Allergènes")) {
        console.error("web-smoke : la cantine ne rend pas les menus factices");
        code = 1;
      }
    }
    if (route === "/alerts") {
      const cards = await page.locator("main article.card").count();
      const text = await page.locator("main").innerText();
      const html = await page.content();
      // L'extrait hostile doit rester du TEXTE : échappé dans le HTML et
      // aucun nœud <img>/<a> fabriqué par son contenu.
      const injected = (await page.locator("main img").count()) > 0 ||
        (await page.locator("main a").count()) > 0;
      if (cards < 1 || !text.includes("<img src=x onerror=alert(1)>") || !html.includes("&lt;img")) {
        console.error("web-smoke : l'alerte factice n'affiche pas l'extrait hostile en texte");
        code = 1;
      }
      if (injected) {
        console.error("web-smoke : l'extrait d'alerte a créé un élément HTML");
        code = 1;
      }
    }
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  }

  // Deux parcours d'appairage, joués avec un pont natif factice : téléphone
  // neuf (aucune session) et session expirée (401 sur les ressources). Dans
  // les deux cas l'app doit atteindre le menu principal (barre d'onglets) sans
  // redémarrage — sinon le garde-fou « pas de session », lu au démarrage,
  // renvoie vers /pairing et l'utilisateur y reste prisonnier (#357).
  for (const scenario of [
    { name: "appairage-neuf", expired: false },
    { name: "appairage-expire", expired: true },
  ]) {
    const flow = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const pageErrors: string[] = [];
    flow.on("pageerror", (err) => pageErrors.push(err.message));
    await flow.addInitScript((expired: boolean) => {
      const g = globalThis as unknown as {
        VSN?: { call: (requestId: string, method: string) => void };
        __vsnResolve?: (requestId: string, resultJson: string) => void;
        __vsnReject?: (requestId: string, errorJson: string) => void;
      };
      let paired = false;
      g.VSN = {
        call(requestId: string, method: string) {
          const resolve = (value: unknown) =>
            setTimeout(() => g.__vsnResolve?.(requestId, JSON.stringify(value)), 10);
          const reject = () =>
            setTimeout(
              () => g.__vsnReject?.(requestId, JSON.stringify({ code: "auth_required", message: "session expirée" })),
              10,
            );
          switch (method) {
            case "session.restore":
            case "session.status":
              // Téléphone neuf : pas de session. Session expirée : le natif
              // en a une, mais elle ne vaut plus rien (401 sur les ressources).
              return resolve({ state: expired ? "restored" : paired ? "restored" : "no_session" });
            case "pairing.scanQr":
              return resolve({
                qr: { login: "demo", jeton: "demo", url: "https://demo.school.invalid" },
                cancelled: false,
              });
            case "pairing.pair":
              paired = true;
              return resolve({ ok: true });
            case "resources.cached":
              return resolve({ payload: null, fetchedAt: 0, stale: false, error: null });
            case "resources.load":
              return expired && !paired ? reject() : resolve({ payload: null, fetchedAt: 0, stale: false, error: null });
            default:
              return resolve({ ok: true });
          }
        },
      };
    }, scenario.expired);
    await flow.goto(`${URL_BASE}#/`, { waitUntil: "networkidle" });
    await flow.waitForURL(/#\/pairing$/, { timeout: 5000 }).catch(() => undefined);
    if (!flow.url().endsWith("#/pairing")) {
      console.error(`web-smoke : ${scenario.name} n'atterrit pas sur l'appairage (${flow.url()})`);
      code = 1;
    }
    await flow.getByRole("button", { name: "Scanner le QR" }).click();
    // Le scan lit le QR PUIS vide le PIN : on attend le QR avant de saisir.
    await flow.getByRole("button", { name: "Rescanner le QR" }).waitFor({ timeout: 5000 });
    await flow.locator("#pairing-pin").fill("1234");
    await flow.getByRole("button", { name: "Terminer" }).click();
    await flow.waitForURL(/#\/$/, { timeout: 5000 }).catch(() => undefined);
    // Le garde-fou « pas de session » renverrait vers /pairing quelques
    // millisecondes plus tard : on attend que l'app se stabilise avant de
    // conclure, sinon on photographie le passage éclair vers l'accueil.
    await flow.waitForTimeout(800);
    const tabs = await flow.locator(".tabbar .tab").count();
    if (!flow.url().endsWith("#/") || tabs < 4) {
      console.error(
        `web-smoke : ${scenario.name} ne mène pas au menu principal (${flow.url()}, ${tabs} onglets)`,
      );
      code = 1;
    }
    if (pageErrors.length) {
      afficherErreurs(`erreurs console (${scenario.name}) :`, "web-smoke-appairage", pageErrors);
      code = 1;
    }
    await flow.screenshot({ path: `${SHOTS}/${scenario.name}.png`, fullPage: true });
    await flow.close();
  }

  // Parcours de déconnexion : le profil invalide la session, l'app renvoie
  // vers l'appairage et n'affiche PLUS l'accueil d'un compte déconnecté
  // (« aucune donnée en cache » pour toujours). Le « Retour » de l'écran
  // d'appairage ne doit pas rouvrir un compte déconnecté (#360).
  {
    const flow = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const pageErrors: string[] = [];
    flow.on("pageerror", (err) => pageErrors.push(err.message));
    await flow.addInitScript(() => {
      const g = globalThis as unknown as {
        VSN?: { call: (requestId: string, method: string, paramsJson?: string) => void };
        __vsnResolve?: (requestId: string, resultJson: string) => void;
        __vsnReject?: (requestId: string, errorJson: string) => void;
      };
      let loggedOut = false;
      g.VSN = {
        call(requestId: string, method: string, paramsJson?: string) {
          const resolve = (value: unknown) =>
            setTimeout(() => g.__vsnResolve?.(requestId, JSON.stringify(value)), 10);
          const reject = (delay: number) =>
            setTimeout(
              () => g.__vsnReject?.(requestId, JSON.stringify({ code: "auth_required", message: "session expirée" })),
              delay,
            );
          let key = "";
          try {
            key = String((JSON.parse(paramsJson ?? "{}") as { key?: string }).key ?? "");
          } catch {
            key = "";
          }
          switch (method) {
            case "session.restore":
            case "session.status":
              return resolve({ state: loggedOut ? "no_session" : "restored" });
            case "session.logout":
              // Le natif invalide la session ET purge les caches.
              loggedOut = true;
              return resolve({ ok: true });
            case "resources.cached":
              return resolve({ payload: null, fetchedAt: 0, stale: false, error: null });
            case "resources.load": {
              if (!loggedOut) return resolve({ payload: null, fetchedAt: 0, stale: false, error: null });
              if (key === "capabilities") {
                // 401 tardif : il arrive APRÈS la déconnexion, ce n'est donc
                // pas une « session expirée » à annoncer (#360).
                return reject(1200);
              }
              // Échec ordinaire : plus de session, plus de cache. Le natif ne
              // répond pas 401 (le compte n'existe plus) — l'accueil d'un
              // compte déconnecté ne doit pas rester accessible (#360).
              return resolve({ payload: null, fetchedAt: 0, stale: false, error: "Aucune donnée en cache." });
            }
            default:
              return resolve({ ok: true });
          }
        },
      };
    });
    await flow.goto(URL_BASE, { waitUntil: "networkidle" });
    // On entre par l'app (comme l'utilisateur) : le « Retour » de
    // l'appairage doit rester dans l'app, pas sortir vers une page vide.
    await flow.getByRole("button", { name: "Profil" }).click();
    await flow.waitForURL(/#\/profile$/, { timeout: 5000 }).catch(() => undefined);
    const logoutTrigger = flow.getByRole("button", { name: "Se déconnecter" }).first();
    await logoutTrigger.click();
    // Clavier (#625) : Échap ferme le dialogue de déconnexion ET rend le focus
    // au déclencheur. On rouvre ensuite pour jouer le parcours de déconnexion
    // existant, inchangé.
    const logoutDialog = flow.getByRole("alertdialog");
    await logoutDialog.waitFor({ timeout: 5000 });
    await flow.keyboard.press("Escape");
    const dialogClosed = await logoutDialog
      .waitFor({ state: "detached", timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    const focusReturned = dialogClosed
      ? await flow
          .waitForFunction(
            () => {
              const element = document.activeElement as HTMLElement | null;
              return (
                element?.tagName === "BUTTON" &&
                (element.textContent ?? "").includes("Se déconnecter") &&
                element.closest(".dialog") === null
              );
            },
            null,
            { timeout: 2000 },
          )
          .then(() => true)
          .catch(() => false)
      : false;
    if (!dialogClosed || !focusReturned) {
      console.error(
        `web-smoke : Échap ne ferme pas le dialogue de déconnexion ou ne rend pas le focus (fermé=${dialogClosed}, focus=${focusReturned})`,
      );
      code = 1;
    }
    await logoutTrigger.click();
    await flow.getByRole("alertdialog").getByRole("button", { name: "Se déconnecter" }).click();
    await flow.waitForURL(/#\/pairing$/, { timeout: 5000 }).catch(() => undefined);
    if (!flow.url().endsWith("#/pairing")) {
      console.error(`web-smoke : la déconnexion ne mène pas à l'appairage (${flow.url()})`);
      code = 1;
    }
    // Le « Retour » de l'appairage ne doit pas rouvrir l'accueil d'un compte
    // déconnecté : le garde-fou renvoie vers l'appairage.
    await flow.getByRole("button", { name: "Retour" }).click();
    await flow.waitForTimeout(600);
    const tabs = await flow.locator(".tabbar .tab").count();
    if (!flow.url().endsWith("#/pairing") || tabs > 0) {
      console.error(`web-smoke : l'accueil d'un compte déconnecté reste accessible (${flow.url()}, ${tabs} onglets)`);
      code = 1;
    }
    // Le 401 tardif ne doit pas être annoncé « session expirée » : c'est
    // l'utilisateur qui a déconnecté le compte (#360).
    await flow.waitForTimeout(2000);
    const text = await flow.locator("body").innerText();
    if (text.includes("Session expirée")) {
      console.error("web-smoke : une déconnexion annoncée comme « session expirée »");
      code = 1;
    }
    if (pageErrors.length) {
      afficherErreurs("erreurs console (deconnexion) :", "web-smoke-deconnexion", pageErrors);
      code = 1;
    }
    await flow.screenshot({ path: `${SHOTS}/deconnexion.png`, fullPage: true });
    await flow.close();
  }

  if (errors.length) {
    afficherErreurs("erreurs console :", "web-smoke", errors);
    code = 1;
  } else if (code === 0) {
    console.log(`web-smoke : OK (${SMOKE_ROUTES.length} routes, 0 erreur console, pas de débordement)`);
  }
  await browser.close();
} catch (e) {
  // Premier item seulement (le message), le reste (pile) dans le log : une
  // pile Playwright fait des centaines de lignes.
  const dump = e instanceof Error ? (e.stack ?? e.message) : String(e);
  const lignes = dump.split("\n").filter((l) => l.trim() !== "");
  console.error("web-smoke : ÉCHEC");
  for (const l of bound(ROOT, "web-smoke-echec", lignes, 1)) console.error("  " + l);
  code = 1;
} finally {
  preview.kill();
}

process.exit(code);

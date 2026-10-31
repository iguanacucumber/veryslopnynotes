// Smoke Playwright du frontend : sert le build local et vérifie toutes les
// routes dans Chromium. Hors `make check` ; `make web-smoke` le lance.
//
// Le bundle de PRODUCTION n'embarque pas le pont factice : le smoke le fournit
// lui-même en exécutant le MÊME module `web/src/bridge/mock.ts` côté Node.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { mockCall } from "../../web/src/bridge/mock";
import { SMOKE_ROUTES } from "../../web/src/smoke-routes";
import { bound } from "./output";

const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 4173;
const URL_BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = "/tmp/opencode/web-shots";

/** Liste bornée : le reste part dans le log complet. */
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
  await page.exposeFunction("__vsnMock", (method: string, params: unknown) => mockCall(method, params));
  await page.addInitScript(BRIDGE_FACTICE);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  for (const [name, route] of SMOKE_ROUTES) {
    await page.goto(`${URL_BASE}#${route}`, { waitUntil: "networkidle" });
    await page.locator("h1, h2, strong").first().waitFor();
    // Attendre la fin des spinners, sinon la preuve montre un état transitoire.
    await page
      .waitForFunction(() => !document.querySelector(".spinner"), null, { timeout: 5000 })
      .catch(() => undefined);
    await page.waitForTimeout(120);
    // Accessibilité : une seule cible `main`, langue déclarée.
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
      // L'extrait hostile doit rester du TEXTE : échappé, aucun nœud créé.
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

  // Deux parcours d'appairage : téléphone neuf (aucune session) et session
  // expirée (401). Les deux doivent atteindre le menu principal sans
  // redémarrage, sinon le garde-fou « pas de session » y enferme l'utilisateur.
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
              // Téléphone neuf : pas de session. Expirée : le natif en a une,
              // mais elle ne vaut plus rien (401 sur les ressources).
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
    // millisecondes plus tard : laisser l'app se stabiliser avant de conclure.
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

  // Déconnexion : le profil invalide la session, l'app renvoie vers
  // l'appairage, dont le « Retour » ne doit pas rouvrir le compte déconnecté.
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
                // 401 tardif : il arrive APRÈS la déconnexion, donc ce n'est
                // pas une « session expirée » à annoncer.
                return reject(1200);
              }
              // Plus de session, plus de cache : l'accueil d'un compte
              // déconnecté ne doit pas rester accessible.
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
    // Clavier : Échap ferme le dialogue ET rend le focus au déclencheur ; on
    // rouvre ensuite pour jouer la déconnexion.
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
    // Le 401 tardif ne doit pas être annoncé « session expirée ».
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
  // Le message seul : une pile Playwright fait des centaines de lignes.
  const dump = e instanceof Error ? (e.stack ?? e.message) : String(e);
  const lignes = dump.split("\n").filter((l) => l.trim() !== "");
  console.error("web-smoke : ÉCHEC");
  for (const l of bound(ROOT, "web-smoke-echec", lignes, 1)) console.error("  " + l);
  code = 1;
} finally {
  preview.kill();
}

process.exit(code);

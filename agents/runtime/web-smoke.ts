// Smoke Playwright du frontend : sert le build local et vérifie toutes les
// routes dans Chromium. Hors `make check` (un navigateur n'est pas requis pour
// vérifier le code) ; `make web-smoke` le lance explicitement.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 4173;
const URL_BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = "/tmp/opencode/web-shots";
const ROUTES = [
  ["index", "/"],
  ["calendar", "/calendar"],
  ["grades", "/grades"],
  ["tasks", "/tasks"],
  ["profile", "/profile"],
  ["settings", "/settings"],
  ["messages", "/messages"],
  ["attendance", "/attendance"],
  ["sanctions", "/sanctions"],
  ["news", "/news"],
  ["canteen", "/canteen"],
  ["alerts", "/alerts"],
  ["fiches", "/fiches"],
  ["pairing", "/pairing"],
] as const;

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
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  for (const [name, route] of ROUTES) {
    await page.goto(`${URL_BASE}#${route}`, { waitUntil: "networkidle" });
    await page.locator("h1, h2, strong").first().waitFor();
    // Les écrans chargent via le pont factice : attendre la fin des spinners
    // avant de capturer, sinon la preuve montre un état transitoire.
    await page
      .waitForFunction(() => !document.querySelector(".spinner"), null, { timeout: 5000 })
      .catch(() => undefined);
    await page.waitForTimeout(120);
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
      console.error(`erreurs console (${scenario.name}) :`, pageErrors);
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
    await flow.getByRole("button", { name: "Se déconnecter" }).first().click();
    await flow.getByRole("dialog").getByRole("button", { name: "Se déconnecter" }).click();
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
      console.error("erreurs console (deconnexion) :", pageErrors);
      code = 1;
    }
    await flow.screenshot({ path: `${SHOTS}/deconnexion.png`, fullPage: true });
    await flow.close();
  }

  if (errors.length) {
    console.error("erreurs console :", errors);
    code = 1;
  } else if (code === 0) {
    console.log(`web-smoke : OK (${ROUTES.length} routes, 0 erreur console, pas de débordement)`);
  }
  await browser.close();
} catch (e) {
  console.error("web-smoke : ÉCHEC", e);
  code = 1;
} finally {
  preview.kill();
}

process.exit(code);

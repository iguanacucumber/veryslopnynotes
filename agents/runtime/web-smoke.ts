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

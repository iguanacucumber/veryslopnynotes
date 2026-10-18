// Smoke Playwright du frontend : sert le build local et vérifie les routes
// principales dans Chromium. Hors `make check` (un navigateur n'est pas requis
// pour vérifier le code) ; `make web-smoke` le lance explicitement.
import { chromium } from "playwright";

const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 4173;
const URL_BASE = `http://127.0.0.1:${PORT}/`;

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
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`${URL_BASE}#/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Accueil", level: 1 }).waitFor();
  await page.getByRole("link", { name: "Cours" }).click();
  await page.getByRole("heading", { name: "Cours", level: 1 }).waitFor();
  await page.getByRole("link", { name: "Notes" }).click();
  await page.getByRole("heading", { name: "Notes", level: 1 }).waitFor();
  await page.screenshot({ path: "/tmp/opencode/web-smoke.png", fullPage: true });

  if (errors.length) {
    console.error("erreurs console :", errors);
    code = 1;
  } else {
    console.log("web-smoke : OK (3 routes, 0 erreur console)");
  }
  await browser.close();
} catch (e) {
  console.error("web-smoke : ÉCHEC", e);
  code = 1;
} finally {
  preview.kill();
}

process.exit(code);

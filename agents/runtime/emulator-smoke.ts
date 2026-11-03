// Smoke ÉMULATEUR (#891) : installe l'APK debug, clique « Connexion démo »,
// vérifie que l'accueil se monte, puis garde captures, DOM et logcat.
//
// Aucun identifiant n'est saisi ici : le bouton démo ouvre le compte PUBLIC de
// l'éditeur, et le script ne connaît ni son hôte ni son mot de passe. Le DOM
// n'est lu qu'après l'accueil pour prouver le rendu — jamais pour en extraire
// une donnée scolaire.
//
// Attentes BORNÉES : chaque boucle a une échéance nommée. Aucun `waitForTimeout`
// (politique anti-flake #924) ; les sondes attendent un ÉVÉNEMENT (boot, socket
// CDP, bouton, route), pas une durée fixe.
import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const APK = join(ROOT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const OUT = process.env["EMULATOR_SMOKE_DIR"] ?? "/tmp/opencode/emulator-smoke";
const APP = "fr.veryslopnynotes.app";
const ACTIVITE = `${APP}/.MainActivity`;
const PORT_CDP = 9222;

const DELAI_ADB_MS = 15_000;
const DELAI_BOOT_MS = 120_000;
const DELAI_INSTALL_MS = 120_000;
const DELAI_APP_MS = 45_000;
const DELAI_CDP_MS = 45_000;
const DELAI_PAIRING_MS = 60_000;
const DELAI_HOME_MS = 90_000;
const INTERVALLE_SONDE_MS = 500;

type Adb = { code: number; stdout: string; stderr: string };

async function adb(args: string[], timeoutMs = DELAI_ADB_MS): Promise<Adb> {
  const proc = Bun.spawn(["adb", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function adbOk(args: string[], timeoutMs = DELAI_ADB_MS): Promise<string> {
  const result = await adb(args, timeoutMs);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `adb ${args.join(" ")} : code ${result.code}${detail ? ` — ${detail}` : " (délai dépassé ?)"}`,
    );
  }
  return result.stdout;
}

/** Sonde un ÉVÉNEMENT, bornée par une échéance explicite. */
async function jusquA(quoi: string, delaiMs: number, essai: () => Promise<boolean>): Promise<void> {
  const echeance = Date.now() + delaiMs;
  for (;;) {
    try {
      if (await essai()) return;
    } catch {
      // La sonde suivante nommera l'échec si l'échéance arrive.
    }
    if (Date.now() >= echeance) throw new Error(`${quoi} : délai de ${delaiMs} ms dépassé`);
    await Bun.sleep(INTERVALLE_SONDE_MS);
  }
}

function ecrire(nom: string, contenu: string): string {
  const chemin = join(OUT, nom);
  writeFileSync(chemin, contenu);
  return chemin;
}

async function capture(page: Page, nom: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${nom}.png`), fullPage: false });
  ecrire(`${nom}.html`, await page.content());
}

async function pidApp(): Promise<string> {
  const pid = (await adbOk(["shell", "pidof", APP])).trim().split(/\s+/)[0] ?? "";
  if (pid === "") throw new Error(`processus ${APP} introuvable`);
  return pid;
}

async function attendreBoot(): Promise<void> {
  await jusquA("démarrage de l'émulateur", DELAI_BOOT_MS, async () => {
    const boot = (await adbOk(["shell", "getprop", "sys.boot_completed"])).trim();
    return boot === "1";
  });
}

async function installer(): Promise<void> {
  if (!existsSync(APK)) throw new Error(`APK debug absent : ${APK}`);
  const install = await adb(["install", "-r", APK], DELAI_INSTALL_MS);
  if (install.code !== 0 || !install.stdout.includes("Success")) {
    throw new Error(
      `installation APK refusée — ${(install.stderr || install.stdout).trim() || "aucune sortie"}`,
    );
  }
  // Session neuve : l'écran d'appairage doit être la première route, pas un
  // accueil restauré d'un run précédent.
  await adbOk(["shell", "pm", "clear", APP]);
}

async function lancer(): Promise<void> {
  await adbOk(["shell", "am", "force-stop", APP]);
  const sortie = await adbOk(["shell", "am", "start", "-W", "-n", ACTIVITE], DELAI_APP_MS);
  if (/Error/i.test(sortie) || !/Status:\s*ok/i.test(sortie)) {
    throw new Error(`lancement refusé — ${sortie.trim()}`);
  }
}

async function attendreSocketCdp(pid: string): Promise<void> {
  const socket = `webview_devtools_remote_${pid}`;
  await jusquA("socket de débogage WebView", DELAI_CDP_MS, async () => {
    await adb(["forward", `tcp:${PORT_CDP}`, `localabstract:${socket}`]);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT_CDP}/json/version`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
}

async function attendreAccueil(page: Page): Promise<void> {
  await jusquA("accueil après l'appairage démo", DELAI_HOME_MS, async () => {
    const hash = await page.evaluate(() => location.hash);
    return hash === "" || hash === "#/";
  });
  await page
    .getByRole("heading", { name: "Accueil", exact: true })
    .waitFor({ state: "visible", timeout: DELAI_HOME_MS });
  const nav = page.locator('nav[aria-label="Navigation principale"]');
  if (!(await nav.isVisible())) throw new Error("barre de navigation absente de l'accueil");
  if (page.url().includes("#/pairing")) throw new Error("retombé sur l'écran d'appairage");
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  let page: Page | null = null;
  let browser: Browser | null = null;
  let pid = "";
  let forwarde = false;

  try {
    await attendreBoot();
    await installer();
    await lancer();
    pid = await pidApp();
    forwarde = true;
    await attendreSocketCdp(pid);

    // `noDefaults` est OBLIGATOIRE : le CDP d'une WebView ne gère pas les
    // contextes de navigateur, et les réglages par défaut de Playwright
    // (`Browser.setDownloadBehavior`) font échouer la connexion.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT_CDP}`, {
      timeout: DELAI_CDP_MS,
      noDefaults: true,
    });
    const pages = browser.contexts().flatMap((context) => context.pages());
    page = pages.find((candidate) => candidate.url().includes("appassets")) ?? pages[0] ?? null;
    if (page === null) throw new Error("aucune page WebView exposée par le CDP");

    const demo = page.getByRole("button", { name: "Connexion démo", exact: true });
    await demo.waitFor({ state: "visible", timeout: DELAI_PAIRING_MS });
    await capture(page, "01-pairing");
    await demo.click({ timeout: DELAI_PAIRING_MS });

    await attendreAccueil(page);
    await capture(page, "02-accueil");
    console.log(`emulator-smoke : accueil atteint (${page.url()})`);
  } catch (error) {
    if (page !== null) {
      const alertes = await page
        .getByRole("alert")
        .allInnerTexts()
        .then((textes) => textes.join(" | "))
        .catch(() => "");
      if (alertes !== "") console.error(`emulator-smoke : alertes affichées — ${alertes.slice(0, 300)}`);
      await capture(page, "99-echec").catch(() => undefined);
    }
    throw error;
  } finally {
    if (pid !== "") {
      const logcat = await adb(["logcat", "-d", "--pid", pid, "-v", "threadtime"]).catch(() => null);
      if (logcat !== null) {
        ecrire("logcat.txt", logcat.stdout);
        console.log(`emulator-smoke : logcat (${logcat.stdout.length} octets) dans ${OUT}`);
      }
    }
    if (forwarde) await adb(["forward", "--remove", `tcp:${PORT_CDP}`]).catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  console.log(`emulator-smoke : preuves dans ${OUT}`);
}

main().catch((error: unknown) => {
  console.error(`emulator-smoke : ÉCHEC — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

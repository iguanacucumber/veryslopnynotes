// Sonde de disponibilité RÉELLE (`/v1/ready`) : jar inscriptible + Chromium
// qui peut démarrer. Aucun accès réseau scolaire, aucun état applicatif.
import { accessSync, constants } from "node:fs";
import { dirname } from "node:path";
import { CHROMIUM_LAUNCH_OPTIONS } from "./manuals-scrape";

/**
 * Sonde réelle : le jar doit être inscriptible et Chromium doit POUVOIR
 * DÉMARRER. `existsSync` ne suffit pas : un seccomp qui refuse les user
 * namespaces laisse le binaire en place et fait échouer chaque scrape.
 * Le lancement est court et mis en cache : `/v1/ready` reste une sonde, pas
 * un scrape déguisé.
 */
const READY_BROWSER_LAUNCH_TIMEOUT_MS = 3_000;
const READY_BROWSER_PROBE_TTL_MS = 60_000;
let browserProbeCache: { readonly at: number; readonly ok: boolean } | null = null;
let browserProbePending: Promise<boolean> | null = null;

export async function defaultReadiness(authFile: string): Promise<Record<string, boolean>> {
  return {
    jar: jarWritable(authFile),
    browser: await browserLaunchable(),
  };
}

function jarWritable(authFile: string): boolean {
  try {
    accessSync(dirname(authFile), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function browserLaunchable(): Promise<boolean> {
  const now = Date.now();
  if (browserProbeCache !== null && now - browserProbeCache.at < READY_BROWSER_PROBE_TTL_MS) {
    return browserProbeCache.ok;
  }
  // Un seul lancement à la fois : deux HEALTHCHECK simultanés ne doivent pas
  // empiler deux Chromium.
  if (browserProbePending !== null) return browserProbePending;
  browserProbePending = probeBrowserLaunch()
    .then((ok) => {
      browserProbeCache = { at: Date.now(), ok };
      return ok;
    })
    .finally(() => {
      browserProbePending = null;
    });
  return browserProbePending;
}

/** Lance puis ferme Chromium ; toute erreur (binaire, sandbox, délai) = faux. */
async function probeBrowserLaunch(): Promise<boolean> {
  let browser: { close: () => Promise<void> } | undefined;
  try {
    const pw = (await import("playwright")) as {
      chromium: { launch: (options: Record<string, unknown>) => Promise<{ close: () => Promise<void> }> };
    };
    browser = await pw.chromium.launch({
      ...CHROMIUM_LAUNCH_OPTIONS,
      timeout: READY_BROWSER_LAUNCH_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  } finally {
    if (browser !== undefined) await browser.close().catch(() => {});
  }
}

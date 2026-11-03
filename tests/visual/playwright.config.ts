import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "*.pw.ts",
  // Une seule page à la fois : deux captures qui se chevauchent ne prouvent
  // rien, et le viewport reste identique au pixel près.
  fullyParallel: false,
  workers: 1,
  // Politique anti-flake : la reprise est réservée au job `web-smoke`, jamais
  // à la suite elle-même.
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 50,
      threshold: 0.2,
    },
  },
  outputDir: resolve(ROOT, "test-results"),
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  reporter: process.env["CI"] ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:4173/",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    launchOptions: {
      // Rendu identique hors du poste : pas de sous-pixel LCD, colorimétrie
      // sRGB et hinting désactivé. Les fontes SN Pro sont vendoriées.
      args: [
        "--force-color-profile=srgb",
        "--disable-lcd-text",
        "--font-render-hinting=none",
        "--disable-font-subpixel-positioning",
      ],
    },
  },
  webServer: {
    command:
      "bunx vite preview --config web/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort",
    cwd: ROOT,
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    timeout: 15_000,
  },
});

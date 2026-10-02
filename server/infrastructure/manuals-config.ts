// Manuels config v1 — comptes personnels via .env.local (issue #25, phase 8).
// Valeurs réelles uniquement en .env.local local, jamais commitées
// (voir .gitignore, check-secrets). .env.example = placeholders.
// Première connexion interactive Playwright, sessions locales réutilisées.
// ponytail: plafond validation présence/format simple.
// Upgrade: validation longueur/complexité si audit l'exige.
export interface ManualsConfig {
  readonly platform: string;
  readonly username: string;
  readonly password: string;
}

export const MANUAL_ENV_KEYS = ["MANUAL_PLATFORM", "MANUAL_USERNAME", "MANUAL_PASSWORD"] as const;

import { loadRequiredEnv } from "./env";

export function loadManualsConfig(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): ManualsConfig | null {
  const got = loadRequiredEnv(env, MANUAL_ENV_KEYS);
  if (!got) return null;
  return { platform: got["MANUAL_PLATFORM"], username: got["MANUAL_USERNAME"], password: got["MANUAL_PASSWORD"] };
}

export function isManualsConfigured(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): boolean {
  return loadManualsConfig(env) !== null;
}

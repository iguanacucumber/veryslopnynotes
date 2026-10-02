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

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

export function loadManualsConfig(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): ManualsConfig | null {
  const platform = clean(env["MANUAL_PLATFORM"]);
  const username = clean(env["MANUAL_USERNAME"]);
  const password = clean(env["MANUAL_PASSWORD"]);
  if (!platform || !username || !password) return null;
  return { platform, username, password };
}

export function isManualsConfigured(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): boolean {
  return loadManualsConfig(env) !== null;
}

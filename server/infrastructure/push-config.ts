// Push infra v1 — config VAPID via .env.local (issue #22, phase 7).
// Ne lit que PUSH_* ; valeurs réelles uniquement en .env.local local,
// jamais commitées (voir .gitignore, check-secrets). .env.example = placeholders.
// ponytail: plafond validation présence/format simple. Upgrade #23 : validation
// longueur clé (87/65 chars base64url) + endpoint par device via StorageProvider.

export interface PushConfig {
  readonly provider: string;
  readonly vapidPublicKey: string;
  readonly vapidPrivateKey: string;
  readonly subject: string;
}

export const PUSH_ENV_KEYS = [
  "PUSH_PROVIDER",
  "PUSH_VAPID_PUBLIC_KEY",
  "PUSH_VAPID_PRIVATE_KEY",
  "PUSH_VAPID_SUBJECT",
] as const;

const DEFAULT_SUBJECT = "mailto:push@example.invalid";

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

export function loadPushConfig(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): PushConfig | null {
  const provider = clean(env["PUSH_PROVIDER"]);
  const vapidPublicKey = clean(env["PUSH_VAPID_PUBLIC_KEY"]);
  const vapidPrivateKey = clean(env["PUSH_VAPID_PRIVATE_KEY"]);
  const subject = clean(env["PUSH_VAPID_SUBJECT"]) || DEFAULT_SUBJECT;
  if (!provider || !vapidPublicKey || !vapidPrivateKey) return null;
  return { provider, vapidPublicKey, vapidPrivateKey, subject };
}

export function isPushConfigured(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): boolean {
  return loadPushConfig(env) !== null;
}

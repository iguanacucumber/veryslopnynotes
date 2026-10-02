// Env configs — helper partagé push/manuals (issue #57). Trim + lecture
// clés requises, null si incomplet. Valeurs réelles uniquement .env.local
// (voir .gitignore, check-secrets). .env.example = placeholders.
// ponytail: plafond validation présence/format. Upgrade: validation types/longueurs si audit l'exige.
export function cleanEnvValue(v: string | undefined): string {
  return (v ?? "").trim();
}

export function loadRequiredEnv(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = cleanEnvValue(env[k]);
    if (!v) return null;
    out[k] = v;
  }
  return out;
}

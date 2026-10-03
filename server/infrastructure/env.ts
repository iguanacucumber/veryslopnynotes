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
  // Prototype nu : `out[k] = v` sur "__proto__" stocke une vraie clé au lieu de
  // passer par le setter de Object.prototype (secret perdu à la lecture).
  const out = Object.create(null) as Record<string, string>;
  for (const k of keys) {
    // only own-property : une clé héritée ("toString", "constructor", ...)
    // ABSENTE. `Object.hasOwn` évite le crash sur une fonction prototype.
    // n'est PAS une variable d'env, elle vaut « absente ».
    const v = Object.hasOwn(env, k) ? cleanEnvValue(env[k]) : "";
    if (!v) return null;
    out[k] = v;
  }
  return out;
}

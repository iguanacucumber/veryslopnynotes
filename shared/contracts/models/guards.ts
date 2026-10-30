// Validateurs partagés par les contrats de `shared/contracts/models`.
// Déplacés ici depuis `models.ts` lors de son découpage par domaine
// (issue #716) : un seul endroit, importé par chaque domaine.

/** Formes d'URL interdites dans une `ref` interne. */
const ABSOLUTE_REF_RE = /:\/\/|^\/\/|data:|\\\\/i;

/** Objet littéral non nul, non tableau. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Chaîne non vide (au moins un caractère non-espacement). */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Date ISO lisible : `Date.parse` TS fait foi (#366). */
export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

/** Nombre fini. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Chaîne non vide, bornée en UTF-16. */
export function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/** Tableau de chaînes non vides, bornées, sans doublon trimmé. */
export function isBoundedStringArray(
  v: unknown,
  maxItems: number,
  maxChars: number,
): v is string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > maxItems) return false;
  const seen = new Set<string>();
  for (const s of v as unknown[]) {
    if (typeof s !== "string") return false;
    const t = s.trim();
    if (t.length === 0 || t.length > maxChars) return false;
    if (seen.has(t)) return false;
    seen.add(t);
  }
  return true;
}

/** Chaîne optionnelle, bornée quand présente. */
export function isOptionalBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && (v.length <= max ? true : [...v].length <= max);
}

/** Chaîne non vide bornée en points de code (paires de surrogates incluses). */
export function isBoundedText(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && [...v].length <= max;
}

/** Nombre fini ou null. */
export function isNullableNumberOrNull(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

/** `ref` interne bornée : non vide, pas une adresse, pas de caractère de
 *  contrôle. Source unique partagée par toutes les références média du contrat. */
export function isOpaqueMediaRef(v: unknown, max: number): boolean {
  if (!isNonEmptyString(v)) return false;
  if ((v as string).length > max) return false;
  if (ABSOLUTE_REF_RE.test(v as string)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v as string)) return false;
  return true;
}

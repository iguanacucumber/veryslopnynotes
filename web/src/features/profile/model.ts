// Modèle du profil (#82/#140) : lecture défensive du payload `profile.me`,
// comptes basculables et initiales. Aucun état, aucun accès au pont : les
// règles restent testables sans React ni WebView.

export interface ChildAccount {
  accountId: string;
  displayName: string;
  classLabel: string;
}

export interface Profile {
  accountId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  classLabel: string;
  periodName: string;
  photoRef: string;
  hasKids: boolean;
  kids: ChildAccount[];
}

export interface SwitchableAccount {
  accountId: string;
  displayName: string;
  classLabel: string;
}

export const MAX_NAME = 64;
export const MAX_ACCOUNT_ID = 64;
export const MAX_KIDS = 8;
const MAX_PHOTO_REF = 200;
const PHOTO_REF_RE = /^photo:[A-Za-z0-9._-]{1,150}$/;

/** Les payloads sont de la DONNÉE : une forme inattendue vaut `null`, jamais
 *  une exception ni un profil inventé. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validAccountId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ACCOUNT_ID;
}

export function isValidPhotoRef(value: string): boolean {
  return value.length <= MAX_PHOTO_REF && PHOTO_REF_RE.test(value);
}

/** `{ user: … }` -> profil, ou `null` quand rien n'est publié / conforme. */
export function parseProfilePayload(payload: string | null | undefined): Profile | null {
  if (!payload) return null;
  let root: unknown;
  try {
    root = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(root) || !isRecord(root["user"])) return null;
  const user = root["user"];
  const kids: ChildAccount[] = [];
  const rawKids = Array.isArray(user["kids"]) ? user["kids"] : [];
  if (rawKids.length > MAX_KIDS) return null;
  for (const raw of rawKids) {
    if (!isRecord(raw)) return null;
    const kid = {
      accountId: text(raw["accountId"]),
      displayName: text(raw["displayName"]),
      classLabel: text(raw["classLabel"]),
    };
    if (!validAccountId(kid.accountId) || kid.displayName === "" || kid.displayName.length > MAX_NAME) return null;
    kids.push(kid);
  }
  const profile: Profile = {
    accountId: text(user["accountId"]),
    displayName: text(user["displayName"]),
    firstName: text(user["firstName"]),
    lastName: text(user["lastName"]),
    classLabel: text(user["classLabel"]),
    periodName: text(user["periodName"]),
    photoRef: text(user["photoRef"]),
    hasKids: user["hasKids"] === true,
    kids,
  };
  if (!validAccountId(profile.accountId)) return null;
  if (profile.displayName === "" || profile.displayName.length > MAX_NAME) return null;
  if (profile.firstName.length > MAX_NAME || profile.lastName.length > MAX_NAME) return null;
  if (profile.classLabel.length > MAX_NAME || profile.periodName.length > MAX_NAME) return null;
  if (profile.photoRef !== "" && !isValidPhotoRef(profile.photoRef)) return null;
  return profile;
}

/** Initiales de repli : même règle que `profileInitials` (Kotlin). */
export function profileInitials(profile: Pick<Profile, "displayName">): string {
  return initialsOf(profile.displayName);
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s\-_]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/** Classe + période, sans séparateur orphelin quand l'un des deux manque. */
export function profileSubtitle(profile: Pick<Profile, "classLabel" | "periodName">): string {
  return [profile.classLabel, profile.periodName].filter((part) => part !== "").join(" · ");
}

/**
 * Comptes proposables : le compte de session d'abord, puis ses enfants, sans
 * doublon ni entrée sans nom, plafonné à MAX_KIDS + 1.
 */
export function switchableAccounts(profile: Profile | null): SwitchableAccount[] {
  if (!profile) return [];
  const out = new Map<string, SwitchableAccount>();
  const add = (id: string, name: string, classLabel: string): void => {
    const key = id.trim();
    const label = name.trim();
    if (!validAccountId(key) || label === "" || out.has(key)) return;
    out.set(key, { accountId: key, displayName: label, classLabel: classLabel.trim() });
  };
  add(profile.accountId, profile.displayName, profile.classLabel);
  for (const kid of profile.kids) {
    if (out.size > MAX_KIDS) break;
    add(kid.accountId, kid.displayName, kid.classLabel);
  }
  return [...out.values()];
}

/** Compte actif : l'id mémorisé s'il existe, sinon le premier (session). */
export function activeAccount(accounts: SwitchableAccount[], currentId: string | null): SwitchableAccount | null {
  if (accounts.length === 0) return null;
  const id = (currentId ?? "").trim();
  return accounts.find((account) => account.accountId === id) ?? accounts[0] ?? null;
}

/** « 1 compte appairé » / « 3 comptes appairés » / « Aucun compte appairé ». */
export function accountCountLabel(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  if (safe === 0) return "Aucun compte appairé";
  return safe === 1 ? "1 compte appairé" : `${safe} comptes appairés`;
}

/**
 * Photo : uniquement une data URL d'image bitmap, bornée. Une URL distante
 * (`https:`) ou un SVG (scriptable) sont refusés : la WebView n'a aucune raison
 * d'aller chercher une image, et le bridge ne renvoie que des octets.
 */
export function isSafePhotoDataUrl(value: string | null | undefined): boolean {
  if (!value || value.length > 4_000_000) return false;
  return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(value);
}

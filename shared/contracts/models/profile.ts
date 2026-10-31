// Infos du compte appairé : nom, classe, période courante, photo. Tout est
// optionnel côté établissement : champ non publié = OMIS, jamais de valeur
// bidon. La photo est une RÉF OPAQUE résolue par le proxy serveur.
import { isBoundedString, isNonEmptyString, isRecord } from "./guards";

export const USER_NAME_MAX_CHARS = 64;
export const USER_CLASS_MAX_CHARS = 64;
export const USER_PHOTO_REF_MAX_CHARS = 200;
export const USER_PERIOD_ID_MAX_CHARS = 64;
export const USER_MAX_KIDS = 8; // enfants listés (compte parent)

/** Borne UNIQUE du libellé de période, miroir Kotlin (`UserProfileRules.MAX_PERIOD_NAME`)
 *  et importée par le web (`web/src/features/profile/model.ts`).
 */
export const USER_PERIOD_NAME_MAX_CHARS = 100;

/** Préfixe des réf photo : `photo:<idFichier>`. */
export const PHOTO_REF_PREFIX = "photo:";

// Jeton de fichier : pas d'espace, pas de séparateur d'URL, pas de chemin.
const PHOTO_REF_ID_RE = /^[A-Za-z0-9._-]{1,150}$/;

/** Réf photo = `photo:<id>` strictement. Toute forme d'adresse est refusée
 *  (`http://`, `https://`, `//cdn…`, `data:`, `photo://`) : l'app ne
 *  manipule qu'un jeton, la résolution se fait côté serveur via /v1/media. */
export function isOpaquePhotoRef(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (!t.startsWith(PHOTO_REF_PREFIX) || t.length > USER_PHOTO_REF_MAX_CHARS) return false;
  return PHOTO_REF_ID_RE.test(t.slice(PHOTO_REF_PREFIX.length));
}

/** Compte enfant d'un compte parent (multi-compte). */
export interface ChildAccount {
  readonly accountId: string;
  readonly displayName: string;
  readonly classLabel?: string;
}

export interface UserInfo {
  readonly accountId: string;
  /** Nom affiché. Requis et non vide : sans nom publié, pas de profil du tout. */
  readonly displayName: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly classLabel?: string;
  /** Période courante (id + libellé). */
  readonly periodId?: string;
  readonly periodName?: string;
  /** Réf opaque de photo (voir `isOpaquePhotoRef`), jamais une URL. */
  readonly photoRef?: string;
  /** Compte parent : des enfants existent (HAVE_KIDS côté app). */
  readonly hasKids?: boolean;
  readonly kids?: ChildAccount[];
}

export function isChildAccount(v: unknown): v is ChildAccount {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["accountId"])) return false;
  if (!isBoundedString(v["displayName"], USER_NAME_MAX_CHARS)) return false;
  if (v["classLabel"] !== undefined && !isBoundedString(v["classLabel"], USER_CLASS_MAX_CHARS)) {
    return false;
  }
  return true;
}

export function isUserInfo(v: unknown): v is UserInfo {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v["accountId"])) return false;
  if (!isBoundedString(v["displayName"], USER_NAME_MAX_CHARS)) return false;
  if (v["firstName"] !== undefined && !isBoundedString(v["firstName"], USER_NAME_MAX_CHARS)) {
    return false;
  }
  if (v["lastName"] !== undefined && !isBoundedString(v["lastName"], USER_NAME_MAX_CHARS)) {
    return false;
  }
  if (v["classLabel"] !== undefined && !isBoundedString(v["classLabel"], USER_CLASS_MAX_CHARS)) {
    return false;
  }
  if (v["periodId"] !== undefined && !isBoundedString(v["periodId"], USER_PERIOD_ID_MAX_CHARS)) {
    return false;
  }
  if (v["periodName"] !== undefined && !isBoundedString(v["periodName"], USER_PERIOD_NAME_MAX_CHARS)) {
    return false;
  }
  // Photo : une URL dans photoRef = contrat invalide (l'app ne doit jamais
  // voir une adresse Pronote, I1 + règle d'or média).
  if (v["photoRef"] !== undefined && !isOpaquePhotoRef(v["photoRef"])) return false;
  if (v["hasKids"] !== undefined && typeof v["hasKids"] !== "boolean") return false;
  const kids = v["kids"];
  if (kids !== undefined) {
    if (!Array.isArray(kids) || kids.length > USER_MAX_KIDS) return false;
    for (const k of kids) if (!isChildAccount(k)) return false;
  }
  return true;
}

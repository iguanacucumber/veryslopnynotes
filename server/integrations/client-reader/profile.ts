// Profil du compte appairé : infos, classe, photo opaque, enfants
// (#82, #197). Déplacé tel quel depuis pronote-client-reader.ts.
import type { ChildAccount, Period, UserInfo } from "../../../shared/contracts/models";
import {
  isChildAccount,
  isOpaquePhotoRef,
  isUserInfo,
  PHOTO_REF_PREFIX,
  USER_CLASS_MAX_CHARS,
  USER_MAX_KIDS,
  USER_NAME_MAX_CHARS,
} from "../../../shared/contracts/models";
import type { PronotePage } from "../../domain/ports";
import { PronoteReadError, untrusted } from "../../domain/ports";
import type { ReaderCtx } from "./primitives";
import { bounded, toReadError } from "./primitives";
import { mapPeriods } from "./notes";

// --- #82 mappers profil ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapUserInfo(accountId: string, info: any, periods: Period[]): UserInfo | null {
  const displayName = typeof info?.name === "string" ? bounded(info.name, USER_NAME_MAX_CHARS) : "";
  // Nom non publié = pas de profil. Jamais de "Élève", jamais de chaîne vide
  // envoyée comme si c'était une identité.
  if (displayName === "") return null;
  const lastName = typeof info?.lastName === "string" ? bounded(info.lastName, USER_NAME_MAX_CHARS) : "";
  const firstName = typeof info?.firstName === "string" ? bounded(info.firstName, USER_NAME_MAX_CHARS) : "";
  const classLabel = typeof info?.className === "string" ? bounded(info.className, USER_CLASS_MAX_CHARS) : "";
  // Période courante = celle qui contient maintenant, sinon la 1re lisible.
  const now = Date.now();
  const current =
    periods.find((p) => Date.parse(p.start) <= now && now <= Date.parse(p.end)) ?? periods[0] ?? null;
  // Photo : RÈF OPAQUE `photo:<id>`, jamais l'URL de la pièce (qui est une
  // donnée externe Pronote et ne doit pas sortir du serveur).
  const rawPicId = typeof info?.profilePicture?.id === "string" ? bounded(info.profilePicture.id, 150) : "";
  const photoRef =
    rawPicId !== "" && isOpaquePhotoRef(`${PHOTO_REF_PREFIX}${rawPicId}`) ? `${PHOTO_REF_PREFIX}${rawPicId}` : undefined;
  const candidate: UserInfo = {
    accountId,
    displayName,
    ...(firstName !== "" ? { firstName } : {}),
    ...(lastName !== "" ? { lastName } : {}),
    ...(classLabel !== "" ? { classLabel } : {}),
    ...(current ? { periodId: current.id, periodName: current.name } : {}),
    ...(photoRef ? { photoRef } : {}),
  };
  return isUserInfo(candidate) ? candidate : null;
}

/** Enfants d'un compte parent (multi-compte #82), bornés et sans doublon. */
function mapKids(raw: unknown): ChildAccount[] {
  const out: ChildAccount[] = [];
  for (const c of (Array.isArray(raw) ? raw : []).slice(0, USER_MAX_KIDS)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = c as any;
    const id = typeof rec?.id === "string" ? bounded(rec.id, 64) : "";
    const name = typeof rec?.name === "string" ? bounded(rec.name, USER_NAME_MAX_CHARS) : "";
    // Enfant sans id ou sans nom = ignoré (jamais de ligne à moitié remplie).
    if (id === "" || name === "") continue;
    const klass = typeof rec?.className === "string" ? bounded(rec.className, USER_CLASS_MAX_CHARS) : "";
    const cand: ChildAccount = { accountId: id, displayName: name, ...(klass !== "" ? { classLabel: klass } : {}) };
    if (isChildAccount(cand) && !out.some((k) => k.accountId === cand.accountId)) out.push(cand);
  }
  return out;
}

/**
 * Infos du compte appairé (#82, parité Papillon Profil) : nom, classe,
 * période courante, photo (réf opaque) + enfants d'un compte parent.
 * DEFENSIF : pronotets expose `client.info` (name/className/profilePicture)
 * et `client.children` (ParentClient). Champ non publié = omis ; nom vide =
 * aucune page (jamais de faux nom, jamais de photo inventée). Seules les
 * erreurs de session remontent (l'app doit se ré-appairer) ; le reste donne
 * une page vide + log. Logs = compteurs seulement, aucun nom/secret.
 * ponytail: période courante déduite des périodes déjà chargées par la lib
 * (aucune requête en plus). Upgrade: currentPeriod() si la lib l'expose.
 */
export async function getUserInfo(ctx: ReaderCtx, accountId: string): Promise<PronotePage<UserInfo>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("me session expired", "session_expired");
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "me");
    ctx.logger(`me -> error ${mapped.code}`);
    throw mapped;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = (client as any)?.info;
    const periods = mapPeriods(((client as { periods?: unknown })?.periods ?? []) as unknown[]);
    const user = mapUserInfo(id, info, periods);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kids = mapKids((client as any)?.children);
    const candidate =
      user === null
        ? null
        : { ...user, hasKids: kids.length > 0, ...(kids.length > 0 ? { kids } : {}) };
    if (candidate === null || !isUserInfo(candidate)) {
      ctx.logger("me -> infos non publiees, page vide");
      return { items: untrusted([]), nextCursor: null };
    }
    ctx.logger(`me -> ok 1 profil, ${kids.length} compte(s) enfant`);
    return { items: untrusted([candidate]), nextCursor: null };
  } catch (err) {
    const mapped = toReadError(err, "me");
    // Session morte = re-appairage, jamais "profil vide" (I6) : une page
    // vide ferait croire à un compte sans données au lieu d'un re-login.
    if (mapped.code === "session_expired") {
      ctx.logger(`me -> error ${mapped.code}`);
      throw mapped;
    }
    // Panne de lecture du profil = donnée absente, jamais une 500.
    ctx.logger(`me -> indisponible (${mapped.code}), page vide`);
    return { items: untrusted([]), nextCursor: null };
  }
}

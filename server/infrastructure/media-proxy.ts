// Proxy téléchargement PJ pédagogiques (issue #84, I1 strict).
// La app ne touche jamais d'URL Pronote directe : elle appelle /v1/media
// avec une ref opaque (voir PedagogicResource.ref). Le serveur résout la ref
// vers l'Attachment pronotets via la session SSO et stream les octets.
// Secrets/cookies session restent côté serveur. Logs compteurs+tailles seuls.
// Contenu servi = donnée, jamais instruction (I6) : à marquer Untrusted côté appelant.
// ponytail: résolution ref par re-parcours lessons/homeworks (pas de cache).
// Upgrade: cache disque + HEAD content-type, route GET /v1/resources liste.
// #82 : une ref photo de profil (`photo:<idFichier>`) est aussi résolue ici,
// pour que l'app n'aie JAMAIS d'adresse de photo à télécharger (I1).
//
// La ref est une CAPACITÉ, pas un pointeur de tableau :
//   - elle est liée à la session appairée (un accountId revendiqué par l'appelant
//     ne redirige jamais la résolution vers un autre compte) ;
//   - le `fileId` qu'elle porte doit être celui du fichier RÉELLEMENT résolu :
//     une publication ENT qui décale les index rend la ref caduque (not_found)
//     au lieu de servir silencieusement la PJ voisine ;
//   - une ref signée (`signMediaRef`, HMAC sha256 sur accountId|kind|li|di|fileId)
//     est en plus inforgeable ; signature absente = format historique accepté
//     sous les deux règles ci-dessus (compatibilité des refs déjà en base/app).
// Aucun octet n'est attendu sans échéance (MEDIA_DOWNLOAD_TIMEOUT_MS).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PronoteClientReader } from "../integrations/pronote-client-reader";

export class MediaProxyError extends Error {
  readonly code: "bad_ref" | "not_found" | "session_expired" | "ent_unavailable";
  constructor(message: string, code: MediaProxyError["code"]) {
    super(message);
    this.name = "MediaProxyError";
    this.code = code;
  }
}

export interface MediaPayload {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Extension d'image autorisée pour le nom renvoyé (borne, pas d'arbitraire). */
const PHOTO_EXT_RE = /^[a-z0-9]{2,4}$/;

/** Signature appended : base64url d'un HMAC sha256 (jamais une URL, jamais un secret). */
const SIG_RE = /^[A-Za-z0-9_-]{40,64}$/;

// Secret de signature des refs : MEDIA_REF_SECRET en déploiement, sinon tiré au
// sort par process (une ref ne survit pas à un redémarrage et n'est pas
// forçable). Jamais journalisé, jamais renvoyé à l'app.
const REF_SECRET: string = (process.env["MEDIA_REF_SECRET"] ?? "").trim() || randomBytes(32).toString("hex");

/**
 * Échéance d'un téléchargement de PJ : une pièce jointe ENT qui ne répond
 * jamais ne doit pas laisser la requête HTTP ouverte (toutes les autres
 * lectures portent un AbortSignal). MEDIA_DOWNLOAD_TIMEOUT_MS règle le délai ;
 * défaut calé sur une PJ Pronote réelle (l'ENT est lent, le réseau domestic
 * l'est aussi) — Borne anti-pause, pas valeur de test.
 * ponytail: pas de reprise ni de retry, un délai dépassé = ent_unavailable.
 */
const DEFAULT_TRANSFER_TIMEOUT_MS = 30_000;
const MAX_TRANSFER_TIMEOUT_MS = 600_000;

function transferTimeoutMs(): number {
  const raw = Number.parseInt((process.env["MEDIA_DOWNLOAD_TIMEOUT_MS"] ?? "").trim(), 10);
  return Number.isFinite(raw) && raw > 0 && raw <= MAX_TRANSFER_TIMEOUT_MS ? raw : DEFAULT_TRANSFER_TIMEOUT_MS;
}

type MediaKind = "lesson-doc" | "lesson-content-file" | "homework-file" | "photo";

interface ParsedRef {
  readonly kind: MediaKind;
  readonly li: number;
  readonly di: number;
  readonly fileId: string;
  readonly sig: string | null;
}

function refMac(accountId: string, p: ParsedRef): string {
  return createHmac("sha256", REF_SECRET).update(`${accountId}|${p.kind}|${p.li}|${p.di}|${p.fileId}`).digest("base64url");
}

/** Comparaison à temps constant : une signature devinée ne se teste pas à l'aveugle. */
function sigMatches(accountId: string, p: ParsedRef): boolean {
  const want = Buffer.from(refMac(accountId, p), "utf8");
  const got = Buffer.from(p.sig ?? "", "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
}

function parseRef(ref: string): ParsedRef | null {
  const parts = (ref ?? "").split(":");
  // #82 : photo de profil = `photo:<idFichier>[:<sig>]` (émis par le mapper profil).
  // L'id n'est jamais une URL : on n'accepte que le jeton du fichier.
  if (parts.length === 2 || parts.length === 3) {
    if (parts[0] !== "photo") return null;
    const fileId = parts[1] ?? "";
    if (!/^[A-Za-z0-9._-]{1,150}$/.test(fileId)) return null;
    const sig = parts.length === 3 ? (parts[2] ?? "") : "";
    if (sig !== "" && !SIG_RE.test(sig)) return null;
    return { kind: "photo", li: 0, di: 0, fileId, sig: sig === "" ? null : sig };
  }
  // Formats émis par mapResources : lesson:<li>:doc:<di>:<fileId>[:<sig>],
  // lesson:<li>:content-file:<di>:<fileId>[:<sig>], homework:<hi>:file:<di>:<fileId>[:<sig>].
  // Moins de 5 segments = ref sans fileId : ce n'est pas une capacité.
  if (parts.length < 5) return null;
  const head = parts[0];
  const li = Number.parseInt(parts[1] ?? "", 10);
  const mid = parts[2];
  const di = Number.parseInt(parts[3] ?? "", 10);
  if (!Number.isFinite(li) || li < 0 || !Number.isFinite(di) || di < 0) return null;
  const kind: MediaKind | null =
    head === "lesson" && mid === "doc"
      ? "lesson-doc"
      : head === "lesson" && mid === "content-file"
        ? "lesson-content-file"
        : head === "homework" && mid === "file"
          ? "homework-file"
          : null;
  if (kind === null) return null;
  const tail = parts.slice(4);
  const last = tail[tail.length - 1] ?? "";
  const sig = tail.length > 1 && SIG_RE.test(last) ? (tail.pop() as string) : "";
  return { kind, li, di, fileId: tail.join(":"), sig: sig === "" ? null : sig };
}

/**
 * Signe une ref émise par le listeur : `<ref>:<HMAC(accountId|kind|li|di|fileId)>`.
 * Le proxy n'accepte une ref signée que pour le compte de la session appairée :
 * la capacité devient inforgeable ET liée à un accountId. Ref illisible ou déjà
 * signée = renvoyée telle quelle (le proxy la refusera ensuite).
 */
export function signMediaRef(accountId: string, ref: string): string {
  const parsed = parseRef((ref ?? "").trim());
  if (!parsed || parsed.sig !== null) return ref;
  // Une ref photo ne peut PAS être signée : `isOpaquePhotoRef` (contrat,
  // USER_PHOTO_REF) refuse un `:` après `photo:`. Signer une photo casserait
  // isUserInfo — il faut un changement de contrat avant, donc on refuse ici.
  if (parsed.kind === "photo") return ref;
  return `${ref}:${refMac((accountId ?? "").trim(), parsed)}`;
}

/** Pièce jointe pronotets : seuls `name`, `id` et `data()` sont lus. */
interface MediaFile {
  readonly name?: string;
  readonly id?: string;
  readonly data: () => Promise<Buffer>;
}

/**
 * La ref ne vaut que pour le fichier qu'elle NOME : si le fichier publié expose
 * un id différent (index décalé par une publication ENT, ref forgée), la ref
 * est caduque → null (not_found), jamais la PJ voisine. Fichier sans id publié :
 * seule la signature peut alors porter l'identité (format historique).
 */
function pickFile(list: unknown, di: number, refFileId: string): MediaFile | null {
  const f = Array.isArray(list) ? (list[di] as MediaFile | undefined) : undefined;
  if (!f || typeof f.data !== "function") return null;
  const fileId = typeof f.id === "string" ? f.id : "";
  if (fileId !== "" && fileId !== refFileId) return null;
  return f;
}

function cleanName(name: string): string {
  const t = name.trim().replace(/[/\\]+/g, "-").slice(0, 120);
  return t || "fichier";
}

/** Attend `work` sous échéance ; un dépassement = erreur typée (jamais une requête ouverte). */
function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new MediaProxyError(`media ${what} timeout`, "ent_unavailable")),
      transferTimeoutMs(),
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Table d'erreurs alignée sur `toReadError` (pronote-client-reader) : une
 * session morte surface en `session_expired` (401, l'app se ré-appaire) au lieu
 * d'un 500 « media unavailable ». Timeout/reste = ent_unavailable.
 */
function toMediaError(err: unknown): MediaProxyError {
  if (err instanceof MediaProxyError) return err;
  const msg = err instanceof Error ? err.message : "";
  if (/session|expired|expir/i.test(msg)) return new MediaProxyError("media session expired", "session_expired");
  if (/timeout|timed out/i.test(msg)) return new MediaProxyError("media timeout", "ent_unavailable");
  return new MediaProxyError("media ent unavailable", "ent_unavailable");
}

/**
 * La ref appartient à la session appairée : l'accountId transmis par l'appelant
 * ne sert qu'au repli mono-compte, jamais à ouvrir le média d'un autre compte.
 */
function pairedAccountId(
  sessions: { currentAccountId?(): string | null },
  accountId: string,
): string {
  const requested = (accountId ?? "").trim();
  try {
    return (sessions.currentAccountId?.() ?? "").trim() || requested;
  } catch {
    return requested;
  }
}

/** Surface du port session utilisée par le proxy (store réel ou adaptateur de test). */
export interface MediaSessions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireClient(accountId: string): any;
  currentAccountId?(): string | null;
  refreshSession?(accountId: string): Promise<void>;
}

/**
 * Résout une ref opaque et télécharge les octets via la session SSO.
 * Lève MediaProxyError typée (bad_ref / not_found / session_expired / ent_unavailable).
 */
export async function downloadMedia(
  sessions: MediaSessions,
  accountId: string,
  ref: string,
  logger?: (message: string) => void,
): Promise<MediaPayload> {
  // accountId vide = serveur mono-compte : session appairée unique (#75).
  const id = pairedAccountId(sessions, accountId);
  const parsed = parseRef((ref ?? "").trim());
  if (!id || !parsed) throw new MediaProxyError("media bad ref", "bad_ref");
  // Ref signée : la signature prouve la capacité ET son compte. Forgée, ou
  // émise pour un autre compte = bad_ref, aucune résolution tentée.
  if (parsed.sig !== null && !sigMatches(id, parsed)) throw new MediaProxyError("media bad ref", "bad_ref");
  let client;
  try {
    // #87 : renouvellement avant lecture (comme tous les autres chemins), puis
    // client de la session appairée — une session morte doit remonter typée.
    await sessions.refreshSession?.(id);
    client = sessions.requireClient(id);
  } catch (err) {
    throw toMediaError(err);
  }
  try {
    const now = new Date();
    // #82 : photo de profil (pièce jointe du client connecté). On ne renvoie
    // que les octets + une extension : l'URL Pronote de la pièce ne sort JAMAIS
    // du serveur.
    if (parsed.kind === "photo") {
      const pic = (
        client as {
          info?: { profilePicture?: { id?: string; url?: string; data?: () => Promise<Buffer> } };
        }
      )?.info?.profilePicture;
      if (!pic || typeof pic.data !== "function") throw new MediaProxyError("media not found", "not_found");
      // Même règle d'identité qu'une PJ de séance : la photo de la ref, pas
      // celle du client (une photo remplacée entre-temps = ref caduque).
      if (typeof pic.id === "string" && pic.id !== "" && pic.id !== parsed.fileId) {
        throw new MediaProxyError("media not found", "not_found");
      }
      const buf = Buffer.from(await withDeadline(pic.data(), "photo"));
      const ext = (String(pic.url ?? "").split("?")[0]?.split(".").pop() ?? "").toLowerCase();
      logger?.(`media -> ok ${buf.length} bytes`);
      return { name: `photo.${PHOTO_EXT_RE.test(ext) ? ext : "png"}`, bytes: new Uint8Array(buf) };
    }
    if (parsed.kind === "homework-file") {
      const later = new Date(now.getTime() + 21 * 86400000);
      const hws = (await client.homework(new Date(now.getTime() - 7 * 86400000), later)) as unknown[];
      const h = (Array.isArray(hws) ? hws[parsed.li] : undefined) as { files?: () => unknown } | undefined;
      const files = typeof h?.files === "function" ? h.files() : [];
      const f = pickFile(files, parsed.di, parsed.fileId);
      if (!f) throw new MediaProxyError("media not found", "not_found");
      const buf = Buffer.from(await withDeadline(f.data(), "download"));
      logger?.(`media -> ok ${buf.length} bytes`);
      return { name: cleanName(String(f.name ?? "fichier")), bytes: new Uint8Array(buf) };
    }
    const lessons = (await client.lessons(
      new Date(now.getTime() - 14 * 86400000),
      new Date(now.getTime() + 7 * 86400000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    )) as any[];
    const lesson = (Array.isArray(lessons) ? lessons[parsed.li] : undefined) as
      | { homeworkDocuments?: unknown; content?: () => Promise<{ files?: () => unknown } | null> }
      | undefined;
    if (!lesson) throw new MediaProxyError("media not found", "not_found");
    if (parsed.kind === "lesson-doc") {
      const f = pickFile(lesson.homeworkDocuments, parsed.di, parsed.fileId);
      if (!f) throw new MediaProxyError("media not found", "not_found");
      const buf = Buffer.from(await withDeadline(f.data(), "download"));
      logger?.(`media -> ok ${buf.length} bytes`);
      return { name: cleanName(String(f.name ?? "fichier")), bytes: new Uint8Array(buf) };
    }
    let content: { files?: () => unknown } | null = null;
    try {
      content = (await lesson.content?.()) ?? null;
    } catch {
      content = null;
    }
    const files = typeof content?.files === "function" ? content.files() : [];
    const f = pickFile(files, parsed.di, parsed.fileId);
    if (!f) throw new MediaProxyError("media not found", "not_found");
    const buf = Buffer.from(await withDeadline(f.data(), "download"));
    logger?.(`media -> ok ${buf.length} bytes`);
    return { name: cleanName(String(f.name ?? "fichier")), bytes: new Uint8Array(buf) };
  } catch (err) {
    throw toMediaError(err);
  }
}

export type { PronoteClientReader };

/**
 * Adaptateur du port média du routeur (server/api/assignments.ts) : un objet,
 * zéro câblage manuel par appelant. Aucune URL n'est exposée à l'app, seule la
 * `ref` opaque l'est.
 */
export function mediaActions(sessions: MediaSessions): { download(accountId: string, ref: string): Promise<MediaPayload> } {
  return {
    download: (accountId, ref) => downloadMedia(sessions, accountId, ref),
  };
}
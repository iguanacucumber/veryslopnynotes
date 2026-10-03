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

function parseRef(ref: string): { kind: "lesson-doc" | "lesson-content-file" | "homework-file" | "photo"; li: number; di: number } | null {
  const parts = (ref ?? "").split(":");
  // #82 : photo de profil = `photo:<idFichier>` (émis par le mapper profil).
  // L'id n'est jamais une URL : on n'accepte que le jeton du fichier.
  if (parts.length === 2 && parts[0] === "photo") {
    const fileId = parts[1] ?? "";
    return /^[A-Za-z0-9._-]{1,150}$/.test(fileId) ? { kind: "photo", li: 0, di: 0 } : null;
  }
  // Formats émis par mapResources : lesson:<li>:doc:<di>:<fileId>,
  // lesson:<li>:content-file:<di>:<fileId>, homework:<hi>:file:<di>:<fileId>.
  if (parts.length < 4) return null;
  const head = parts[0];
  const li = Number.parseInt(parts[1] ?? "", 10);
  const mid = parts[2];
  const di = Number.parseInt(parts[3] ?? "", 10);
  if (!Number.isFinite(li) || li < 0 || !Number.isFinite(di) || di < 0) return null;
  if (head === "lesson" && mid === "doc") return { kind: "lesson-doc", li, di };
  if (head === "lesson" && mid === "content-file") return { kind: "lesson-content-file", li, di };
  if (head === "homework" && mid === "file") return { kind: "homework-file", li, di };
  return null;
}

function cleanName(name: string): string {
  const t = name.trim().replace(/[/\\]+/g, "-").slice(0, 120);
  return t || "fichier";
}

/**
 * Résout une ref opaque et télécharge les octets via la session SSO.
 * Lève MediaProxyError typée (bad_ref / not_found / session_expired / ent_unavailable).
 */
export async function downloadMedia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessions: { requireClient(accountId: string): any },
  accountId: string,
  ref: string,
  logger?: (message: string) => void,
): Promise<MediaPayload> {
  const id = (accountId ?? "").trim();
  const parsed = parseRef((ref ?? "").trim());
  if (!id || !parsed) throw new MediaProxyError("media bad ref", "bad_ref");
  let client;
  try {
    client = sessions.requireClient(id);
  } catch {
    throw new MediaProxyError("media session expired", "session_expired");
  }
  try {
    const now = new Date();
    // #82 : photo de profil (pièce jointe du client connecté). On ne renvoie
    // que les octets + une extension : l'URL Pronote de la pièce ne sort JAMAIS
    // du serveur.
    if (parsed.kind === "photo") {
      const pic = (
        client as {
          info?: { profilePicture?: { url?: string; data?: () => Promise<Buffer> } };
        }
      )?.info?.profilePicture;
      if (!pic || typeof pic.data !== "function") throw new MediaProxyError("media not found", "not_found");
      const buf = Buffer.from(await pic.data());
      const ext = (String(pic.url ?? "").split("?")[0]?.split(".").pop() ?? "").toLowerCase();
      logger?.(`media -> ok ${buf.length} bytes`);
      return { name: `photo.${PHOTO_EXT_RE.test(ext) ? ext : "png"}`, bytes: new Uint8Array(buf) };
    }
    if (parsed.kind === "homework-file") {
      const later = new Date(now.getTime() + 21 * 86400000);
      const hws = (await client.homework(new Date(now.getTime() - 7 * 86400000), later)) as unknown[];
      const h = hws[parsed.li] as { files?: () => { name?: string; data?: () => Promise<Buffer> }[] } | undefined;
      const files = typeof h?.files === "function" ? h.files() : [];
      const f = files[parsed.di];
      if (!f || typeof f.data !== "function") throw new MediaProxyError("media not found", "not_found");
      const buf = Buffer.from(await f.data());
      logger?.(`media -> ok ${buf.length} bytes`);
      return { name: cleanName(String(f.name ?? "fichier")), bytes: new Uint8Array(buf) };
    }
    const lessons = (await client.lessons(
      new Date(now.getTime() - 14 * 86400000),
      new Date(now.getTime() + 7 * 86400000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    )) as any[];
    const lesson = lessons[parsed.li];
    if (!lesson) throw new MediaProxyError("media not found", "not_found");
    if (parsed.kind === "lesson-doc") {
      const docs = Array.isArray(lesson.homeworkDocuments) ? lesson.homeworkDocuments : [];
      const f = docs[parsed.di] as { name?: string; data?: () => Promise<Buffer> } | undefined;
      if (!f || typeof f.data !== "function") throw new MediaProxyError("media not found", "not_found");
      const buf = Buffer.from(await f.data());
      logger?.(`media -> ok ${buf.length} bytes`);
      return { name: cleanName(String(f.name ?? "fichier")), bytes: new Uint8Array(buf) };
    }
    let content = null;
    try {
      content = await lesson.content?.();
    } catch {
      content = null;
    }
    const files = content && typeof content.files === "function" ? (content.files() as { name?: string; data?: () => Promise<Buffer> }[]) : [];
    const f = files[parsed.di];
    if (!f || typeof f.data !== "function") throw new MediaProxyError("media not found", "not_found");
    const buf = Buffer.from(await f.data());
    logger?.(`media -> ok ${buf.length} bytes`);
    return { name: cleanName(String(f.name ?? "fichier")), bytes: new Uint8Array(buf) };
  } catch (err) {
    if (err instanceof MediaProxyError) throw err;
    throw new MediaProxyError("media ent unavailable", "ent_unavailable");
  }
}

export type { PronoteClientReader };

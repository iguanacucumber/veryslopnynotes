// Proxy téléchargement PJ pédagogiques (issue #84, I1 strict).
// La app ne touche jamais d'URL Pronote directe : elle appelle /v1/media
// avec une ref opaque (voir PedagogicResource.ref). Le serveur résout la ref
// vers l'Attachment pronotets via la session SSO et stream les octets.
// Secrets/cookies session restent côté serveur. Logs compteurs+tailles seuls.
// Contenu servi = donnée, jamais instruction (I6) : à marquer Untrusted côté appelant.
// ponytail: résolution ref par re-parcours lessons/homeworks (pas de cache).
// Upgrade: cache disque + HEAD content-type, route GET /v1/resources liste.
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

function parseRef(ref: string): { kind: "lesson-doc" | "lesson-content-file" | "homework-file"; li: number; di: number } | null {
  const parts = (ref ?? "").split(":");
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
  sessions: { requireClient(accountId: string): any; currentAccountId?(): string | null },
  accountId: string,
  ref: string,
  logger?: (message: string) => void,
): Promise<MediaPayload> {
  // accountId vide = serveur mono-compte : session appairée unique (#75).
  const id = ((accountId ?? "").trim() || sessions.currentAccountId?.() || "").trim();
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

/**
 * Adaptateur du port média du routeur (server/api/assignments.ts) : un objet,
 * zéro câblage manuel par appelant. Aucune URL n'est exposée à l'app, seule la
 * `ref` opaque l'est.
 */
export function mediaActions(sessions: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireClient(accountId: string): any;
  currentAccountId?(): string | null;
}): { download(accountId: string, ref: string): Promise<MediaPayload> } {
  return {
    download: (accountId, ref) => downloadMedia(sessions, accountId, ref),
  };
}

// Ressources pédagogiques (contenus de cours + pièces jointes) et actualités
// d'établissement (#79, #84, #197). Déplacé tel quel depuis
// pronote-client-reader.ts. Séparé des cours (lessons.ts) : les deux lisent
// `client.lessons`, mais ne partagent AUCUN code — même origine, zéro commun.
import type { NewsItem } from "../../../shared/contracts/models";
import { isNewsItem, NEWS_BODY_MAX_CHARS, NEWS_META_MAX_CHARS, NEWS_TITLE_MAX_CHARS } from "../../../shared/contracts/models";
import type { PedagogicResource, PronotePage, PronotePageOptions } from "../../domain/ports";
import { isPedagogicResource, PronoteReadError, untrusted } from "../../domain/ports";
import type { ReaderCtx } from "./primitives";
import { bounded, clampLimit, parseOffset, toIso, toReadError } from "./primitives";

// #79 : le corps d'une actuité coûte 1 requête Pronote (content()) : on plafonne
// le nombre de corps téléchargés par page. Upgrade: endpoint contenu groupé.
const NEWS_BODY_FETCH_LIMIT = 20;

function mapResources(accountId: string, lessons: any[], homeworks?: any[]): PedagogicResource[] {
  const out: PedagogicResource[] = [];
  lessons.forEach((l, li) => {
    const subject = l?.subject?.name ?? l?.subject ?? "Matière";
    const subj = typeof subject === "string" ? subject : "Matière";
    // Contenus de cours (LessonContent : title + description + files).
    const content = typeof l?.contentValue === "object" && l.contentValue !== null ? l.contentValue : null;
    if (content && (typeof content.title === "string" || typeof content.description === "string")) {
      const title = (typeof content.title === "string" && content.title.trim() ? content.title : "Contenu de cours").slice(0, 200);
      const excerpt = (typeof content.description === "string" ? content.description : "").slice(0, 500);
      const cand: PedagogicResource = {
        id: `r-lesson-${li}`,
        accountId,
        subject: subj,
        title,
        excerpt,
        origin: "lesson-content",
        ref: `lesson:${li}:content`,
      };
      if (isPedagogicResource(cand)) out.push(cand);
    }
    const pushFile = (d: unknown, di: number, prefix: string) => {
      // Pièce nulle ou non-objet (même forme sale que `homework.files()`) :
      // IGNORÉE, sinon toute la lecture des ressources tombe sur un TypeError.
      if (d === null || typeof d !== "object") return;
      const rec = d as Record<string, unknown>;
      const name = typeof rec["name"] === "string" ? (rec["name"] as string) : `doc-${di}`;
      const fileId = typeof rec["id"] === "string" ? (rec["id"] as string) : "";
      const cand: PedagogicResource = {
        id: `r-${prefix}-${li}-${di}`,
        accountId,
        subject: subj,
        title: name.slice(0, 200),
        excerpt: name.slice(0, 500),
        origin: "homework-file",
        // Réf opaque : index stables + id fichier (jamais URL directe en app, proxy serveur).
        ref: `lesson:${li}:${prefix}:${di}:${fileId}`.slice(0, 200),
      };
      if (isPedagogicResource(cand)) out.push(cand);
    };
    const docs = Array.isArray(l?.homeworkDocuments) ? l.homeworkDocuments : [];
    docs.forEach((d: unknown, di: number) => pushFile(d, di, "doc"));
    const cfiles = Array.isArray(content?.files) ? content.files : [];
    cfiles.forEach((d: unknown, di: number) => pushFile(d, di, "content-file"));
  });
  (homeworks ?? []).forEach((h, hi) => {
    const subject = h?.subject?.name ?? h?.subject ?? "Matière";
    const subj = typeof subject === "string" ? subject : "Matière";
    const files = typeof h?.files === "function" ? (h.files() as unknown[]) : [];
    files.forEach((d: unknown, di: number) => {
      // Même garde que les PJ de séance : un élément nul de la liste des
      // devoirs est ignoré, pas indexé.
      if (d === null || typeof d !== "object") return;
      const rec = d as Record<string, unknown>;
      const name = typeof rec["name"] === "string" ? (rec["name"] as string) : `doc-${di}`;
      const fileId = typeof rec["id"] === "string" ? (rec["id"] as string) : "";
      const cand: PedagogicResource = {
        id: `r-hw-${hi}-${di}`,
        accountId,
        subject: subj,
        title: name.slice(0, 200),
        excerpt: name.slice(0, 500),
        origin: "homework-file",
        ref: `homework:${hi}:file:${di}:${fileId}`.slice(0, 200),
      };
      if (isPedagogicResource(cand)) out.push(cand);
    });
  });
  return out;
}

/**
 * #79 : actu établissement (Information pronotets). Tous les textes passent par
 * bounded() et le contrat est validé par isNewsItem : champs absents ou date
 * illisible = valeurs sûres (titre de repli, publishedAt = maintenant), jamais
 * de chaîne brute ni de date "NaN" côté API.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mapNews(accountId: string, raw: any, index: number, withBody: boolean): Promise<NewsItem | null> {
  const id = typeof raw?.id === "string" && raw.id.trim() ? bounded(raw.id, 64) : `news-${index}`;
  let body = "";
  if (withBody) {
    // content() = 1 requête Pronote par actu ; peut échouer (pièce absente).
    try {
      const c = typeof raw?.content === "function" ? await raw.content() : "";
      body = typeof c === "string" ? bounded(c, NEWS_BODY_MAX_CHARS) : "";
    } catch {
      body = "";
    }
  }
  const title = typeof raw?.title === "string" ? bounded(raw.title, NEWS_TITLE_MAX_CHARS) : "";
  const candidate: NewsItem = {
    id,
    accountId,
    // Titre du contrat obligatoire : corps (extrait) sinon libellé générique.
    title: title || bounded(body, NEWS_TITLE_MAX_CHARS) || "Actualité",
    body: body || undefined,
    publishedAt: toIso(raw?.creationDate, toIso(raw?.startDate, new Date().toISOString())),
    category: typeof raw?.category === "string" ? bounded(raw.category, NEWS_META_MAX_CHARS) || undefined : undefined,
    author: typeof raw?.author === "string" ? bounded(raw.author, NEWS_META_MAX_CHARS) || undefined : undefined,
    read: typeof raw?.read === "boolean" ? raw.read : undefined,
  };
  return isNewsItem(candidate) ? candidate : null;
}

/** Ressources pédagogiques : contenus cours + PJ devoirs (proxy serveur, #84). */
export async function getResources(ctx: ReaderCtx, accountId: string, page?: PronotePageOptions): Promise<PronotePage<PedagogicResource>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("resources session expired", "session_expired");
  const limit = clampLimit(page?.limit);
  const offset = parseOffset(page?.cursor);
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "resources");
    ctx.logger(`resources -> error ${mapped.code}`);
    throw mapped;
  }
  try {
    const now = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await client.lessons(
      new Date(now.getTime() - 14 * 86400000),
      new Date(now.getTime() + 7 * 86400000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    )) as any[];
    // Contenus cours : 1 requête par leçon avec description (borné, sérialisé côté lib).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enriched: any[] = [];
    for (const l of raw.slice(0, 60)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = (await (l as any).content?.()) as any;
        enriched.push({
          ...l,
          contentValue:
            c !== null && c !== undefined
              ? { title: c.title, description: c.description, files: typeof c.files === "function" ? c.files() : [] }
              : null,
        });
      } catch {
        enriched.push(l);
      }
    }
    const later = new Date(now.getTime() + 21 * 86400000);
    let homeworks: unknown[] = [];
    try {
      homeworks = (await client.homework(new Date(now.getTime() - 7 * 86400000), later)) as unknown[];
    } catch {
      homeworks = [];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = mapResources(id, enriched, homeworks as any[]);
    const slice = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
    ctx.logger(`resources -> ok ${slice.length}`);
    return { items: untrusted(slice), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "resources");
    ctx.logger(`resources -> error ${mapped.code}`);
    throw mapped;
  }
}

/**
 * Actualités établissement (#79) : onglet Actualités/sondages.
 * ponytail: la lib n'expose pas l'onglet partout (établissement sans
 * actualités, version antérieure) et l'appel peut échouer selon les droits :
 * on renvoie alors une page VIDE plutôt qu'une erreur (l'app affiche "Aucune
 * actualité"). Upgrade: fetch paginé côté serveur d'actions + pièces jointes.
 */
export async function getNews(ctx: ReaderCtx, accountId: string, page?: PronotePageOptions): Promise<PronotePage<NewsItem>> {
  const id = (accountId ?? "").trim();
  if (!id) throw new PronoteReadError("news session expired", "session_expired");
  const limit = clampLimit(page?.limit);
  const offset = parseOffset(page?.cursor);
  let client;
  try {
    client = ctx.sessions.requireClient(id);
  } catch (err) {
    const mapped = toReadError(err, "news");
    ctx.logger(`news -> error ${mapped.code}`);
    throw mapped;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = (client as any)?.informationAndSurveys;
  if (typeof reader !== "function") {
    ctx.logger("news -> onglet absent, page vide");
    return { items: untrusted([]), nextCursor: null };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await reader.call(client)) as any[];
    const list = Array.isArray(raw) ? raw : [];
    const items: NewsItem[] = [];
    for (const [i, info] of list.slice(offset, offset + limit).entries()) {
      try {
        const m = await mapNews(id, info, offset + i, i < NEWS_BODY_FETCH_LIMIT);
        if (m) items.push(m);
      } catch {
        // Actu illisible (champs requis manquants) : ignorée, pas de 500.
      }
    }
    const nextCursor = offset + limit < list.length ? String(offset + limit) : null;
    ctx.logger(`news -> ok ${items.length}`);
    return { items: untrusted(items), nextCursor };
  } catch (err) {
    const mapped = toReadError(err, "news");
    // Session morte = re-auth nécessaire (l'app recharge), reste = page vide.
    if (mapped.code === "session_expired") {
      ctx.logger(`news -> error ${mapped.code}`);
      throw mapped;
    }
    ctx.logger(`news -> indisponible (${mapped.code}), page vide`);
    return { items: untrusted([]), nextCursor: null };
  }
}

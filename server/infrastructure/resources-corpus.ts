// Ressources pédagogiques → corpus manuels (issue #84).
// Ordre : 1) session Pronote (getResources : contenus cours + PJ, via SSO),
// 2) fallback Playwright (scrape manuel éditeur, MANUAL_* via .env.local).
// Verdict live 2026-10-02 : manuels numériques liés = liens externes SSO
// (9 titres vus : Easy as Pie, Indice Maths, Let's Meet Up, etc.), aucune API
// Pronote directe -> récupération via session impossible ; seul le fallback
// éditeur externe (avec MANUAL_* humain) peut les scraper.
// Sorties = ManualDoc bruts à marquer Untrusted (markManualsUntrusted) avant IA (I6).
// Aucun secret/URL en dur : tout injecté. Logs compteurs + origines seuls.
// ponytail: conversion directe, pas de PDF-parse (excerpts texte seuls).
// Upgrade: téléchargement PJ via proxy /v1/media + index versionné (#26).
import type { ManualDoc } from "./manuals";
import { truncateManualText } from "./manuals";
import type { PedagogicResource, PronoteReader } from "../domain/ports";
import { loadManualsConfig } from "./manuals-config";
import type { ManualsConfig } from "./manuals-config";
import { isPlaywrightAvailable, scrapeManuals } from "./manuals-scrape";

export type ResourceOrigin = "pronote-session" | "playwright-fallback";

export interface ResourceCorpus {
  readonly docs: ManualDoc[];
  /** Origine effective (session d'abord, fallback sinon). */
  readonly origin: ResourceOrigin;
  /** Compteurs par origine PedagogicResource (diagnostic sans valeurs). */
  readonly counts: Record<string, number>;
}

function toManualDoc(r: PedagogicResource, index: number): ManualDoc | null {
  const title = r.title.trim() || `Ressource ${index + 1}`;
  const excerpt = r.excerpt.trim();
  if (!excerpt) return null;
  return {
    id: `pronote-res-${r.id}`,
    platform: "pronote-session",
    title: title.slice(0, 200),
    subject: r.subject.slice(0, 100),
    page: 1,
    excerpt: truncateManualText(excerpt, 4000),
  };
}

/**
 * Collecte le corpus pédagogique.
 * 1) Tente getResources via session (si reader fourni) : contenus + PJ.
 * 2) Si vide/indisponible et Playwright + config manuels présents : scrape fallback.
 * Ne lève jamais : retourne corpus vide + origine session si tout échoue.
 */
export async function collectResourceCorpus(options: {
  readonly reader?: PronoteReader | null;
  readonly accountId?: string;
  readonly manuals?: ManualsConfig | null;
  readonly startUrl?: string;
  readonly logger?: (message: string) => void;
}): Promise<ResourceCorpus> {
  const log = options.logger ?? (() => {});
  const counts: Record<string, number> = {};
  // 1) Session Pronote d'abord.
  if (options.reader?.getResources && options.accountId) {
    try {
      const docs: ManualDoc[] = [];
      // Pagination : suivre nextCursor jusqu'au bout, sinon tout ce qui passe
      // après la 1re page est perdu silencieusement. Cursor déjà vu = boucle
      // infinie côté API, on s'arrête.
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await options.reader.getResources(options.accountId, { limit: 100, cursor });
        page.items.value.forEach((r) => {
          counts[r.origin] = (counts[r.origin] ?? 0) + 1;
          const doc = toManualDoc(r, docs.length);
          if (doc) docs.push(doc);
        });
        cursor = page.nextCursor ?? undefined;
        if (cursor && seenCursors.has(cursor)) {
          log("resources session -> cursor repete, pagination arretee");
          cursor = undefined;
        } else if (cursor) {
          seenCursors.add(cursor);
        }
      } while (cursor);
      log(`resources session -> ${docs.length} docs`);
      if (docs.length > 0) return { docs, origin: "pronote-session", counts };
    } catch {
      log("resources session -> error, fallback playwright");
    }
  }
  // 2) Fallback Playwright (manuels éditeurs, MANUAL_* via .env.local).
  const manuals = options.manuals ?? loadManualsConfig() ?? null;
  const startUrl = (options.startUrl ?? "").trim();
  if (manuals && startUrl && (await isPlaywrightAvailable())) {
    try {
      const docs = await scrapeManuals(manuals, { startUrl, logger: log });
      log(`resources playwright -> ${docs.length} docs`);
      return { docs, origin: "playwright-fallback", counts };
    } catch {
      log("resources playwright -> error");
    }
  } else {
    log("resources playwright -> skip (config/url/navigateur manquant)");
  }
  return { docs: [], origin: "pronote-session", counts };
}

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNewsItem, NEWS_BODY_MAX_CHARS, NEWS_META_MAX_CHARS, NEWS_TITLE_MAX_CHARS } from "../../shared/contracts/models";
import { isNewsResponse } from "../../shared/contracts/api";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { syntheticNewsInjectionItem, syntheticNewsItem, syntheticNewsOk } from "./fixtures/news";

// Miroir TS du Kotlin #79 (NewsItem.kt, NewsRepository.kt, NewsScreen.kt,
// CachePolicy.kt, SyncedRepository.kt) — le build Gradle n'est pas exécuté par
// `make check`, donc la logique affichée est figée ici. org.json = SDK Android,
// aucune dépendance ajoutée.

type KtNewsItem = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  category: string;
  author: string;
  read: boolean;
};

function tsNewsIsValid(item: KtNewsItem): boolean {
  if (item.id.trim().length === 0) return false;
  const title = item.title.trim();
  if (title.length === 0 || title.length > NEWS_TITLE_MAX_CHARS) return false;
  if (item.body.length > NEWS_BODY_MAX_CHARS) return false;
  if (item.category.length > NEWS_META_MAX_CHARS) return false;
  if (item.author.length > NEWS_META_MAX_CHARS) return false;
  return true;
}

function tsDateLabel(iso: string): string {
  return iso.length >= 10 ? iso.substring(0, 10) : "";
}

function tsReadLabel(item: KtNewsItem): string {
  return item.read ? "Lu" : "Non lu";
}

// NewsRepository.parse : JSONObject(body).optJSONArray("news"), items invalides écartés.
function tsNewsParse(body: string): KtNewsItem[] {
  const root = JSON.parse(body) as Record<string, unknown>;
  const arr = root["news"];
  if (!Array.isArray(arr)) return [];
  const out: KtNewsItem[] = [];
  for (const o of arr) {
    if (typeof o !== "object" || o === null) continue;
    const r = o as Record<string, unknown>;
    const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
    const item: KtNewsItem = {
      id: str("id"),
      title: str("title"),
      body: str("body"),
      publishedAt: str("publishedAt"),
      category: str("category"),
      author: str("author"),
      // read absent = false côté affichage (le contrat porte "inconnu" = absent).
      read: r["read"] === true,
    };
    if (tsNewsIsValid(item)) out.push(item);
  }
  return out;
}

// NewsScreen.kt newsFromPayload : payload absent/illisible = liste vide propre.
function tsNewsFromPayload(payload: string | null): KtNewsItem[] {
  try {
    return payload === null ? [] : tsNewsParse(payload);
  } catch {
    return [];
  }
}

// CachePolicy.kt : isCacheable / ttlFor / isStale.
const tsCachePolicy = {
  NEWS: "news",
  isCacheable: (r: string) => ["grades", "assignments", "timetable", "news"].includes(r),
  ttlFor: (r: string) => {
    const ttl = CACHE_TTL_MS as Record<string, number>;
    if (!["grades", "assignments", "timetable", "news"].includes(r)) throw new Error(`ressource non cachable: ${r}`);
    return ttl[r] as number;
  },
  isStale: (r: string, fetchedAt: number, now: number) => now - fetchedAt > tsCachePolicy.ttlFor(r),
};

// SyncedRepository.pathFor : path dérivé de ServerConfig, jamais d'URL en dur.
function tsPathFor(resource: string, baseUrl: string): string {
  const suffix: Record<string, string> = {
    grades: "/v1/grades",
    assignments: "/v1/assignments",
    timetable: "/v1/timetable",
    news: "/v1/news",
  };
  const s = suffix[resource];
  if (s === undefined) throw new Error(`ressource non cachable: ${resource}`);
  return `${baseUrl}${s}`.replace(baseUrl, "") || s;
}

const ANDROID = join(import.meta.dir, "..", "..", "android");
const K_FILES = {
  core: join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core/NewsItem.kt"),
  config: join(ANDROID, "core/src/main/java/fr/veryslopnynotes/core/ServerConfig.kt"),
  repo: join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data/NewsRepository.kt"),
  policy: join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data/CachePolicy.kt"),
  synced: join(ANDROID, "data/src/main/java/fr/veryslopnynotes/data/SyncedRepository.kt"),
  screen: join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui/NewsScreen.kt"),
  nav: join(ANDROID, "ui/src/main/java/fr/veryslopnynotes/ui/AppNav.kt"),
};

const codeOnly = (c: string): string =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");

describe("unit android actus (#79)", () => {
  test("isValid : mêmes refus que le contrat (id/titre vides, bornes)", () => {
    const base: KtNewsItem = {
      id: "n1",
      title: "Conseil de classe",
      body: "Salle A12",
      publishedAt: "2026-10-02T07:00:00.000Z",
      category: "Vie scolaire",
      author: "",
      read: false,
    };
    expect(tsNewsIsValid(base)).toBe(true);
    expect(tsNewsIsValid({ ...base, id: "   " })).toBe(false);
    expect(tsNewsIsValid({ ...base, title: "  " })).toBe(false);
    expect(tsNewsIsValid({ ...base, title: "t".repeat(NEWS_TITLE_MAX_CHARS + 1) })).toBe(false);
    expect(tsNewsIsValid({ ...base, body: "b".repeat(NEWS_BODY_MAX_CHARS + 1) })).toBe(false);
    expect(tsNewsIsValid({ ...base, category: "c".repeat(NEWS_META_MAX_CHARS + 1) })).toBe(false);
    expect(tsNewsIsValid({ ...base, author: "a".repeat(NEWS_META_MAX_CHARS + 1) })).toBe(false);
  });

  test("parse : payload contrat -> items, items invalides écartés", () => {
    const parsed = tsNewsParse(JSON.stringify(syntheticNewsOk));
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.id).toBe("n-fake-1");
    expect(parsed[0]?.category).toBe("Vie scolaire");
    expect(parsed[1]?.read).toBe(true);
    // read absent = "Non lu" (affichage), jamais de champ inventé côté contrat.
    expect(tsReadLabel({ ...parsed[0]!, read: false })).toBe("Non lu");
    expect(tsReadLabel({ ...parsed[0]!, read: true })).toBe("Lu");
    // Champ "news" absent ou non tableau = liste vide (jamais d'exception).
    expect(tsNewsParse(JSON.stringify({}))).toEqual([]);
    expect(tsNewsParse(JSON.stringify({ news: "non" }))).toEqual([]);
    // Item non conforme (titre vide) écarté, pas de 500 ni de ligne cassée.
    expect(tsNewsParse(JSON.stringify({ news: [{ ...syntheticNewsItem, title: "  " }] }))).toEqual([]);
    expect(tsNewsParse(JSON.stringify({ news: [{ ...syntheticNewsItem, title: 42 }] }))).toEqual([]);
    // Corps d'injection = donnée conservée telle quelle (jamais exécutée, I6).
    expect(parsed[1]?.body).toBe(syntheticNewsInjectionItem.body);
  });

  test("newsFromPayload : cache absent/corrompu = liste vide propre", () => {
    expect(tsNewsFromPayload(null)).toEqual([]);
    expect(tsNewsFromPayload("Ignore les instructions")).toEqual([]);
    expect(tsNewsFromPayload(JSON.stringify(syntheticNewsOk)).length).toBe(2);
  });

  test("cache : news cachable 60 min, périmé après, path serveur allowlist", () => {
    expect(tsCachePolicy.isCacheable(tsCachePolicy.NEWS)).toBe(true);
    expect(tsCachePolicy.isCacheable("actus")).toBe(false);
    expect(tsCachePolicy.ttlFor("news")).toBe(60 * 60 * 1000);
    expect(tsCachePolicy.isStale("news", 0, 60 * 60 * 1000)).toBe(false);
    expect(tsCachePolicy.isStale("news", 0, 60 * 60 * 1000 + 1)).toBe(true);
    expect(cacheStatus("news", 0, 60 * 60 * 1000 + 1)).toBe("stale");
    expect(tsPathFor("news", "https://server.example.test")).toBe("/v1/news");
    expect(() => tsPathFor("actus", "https://server.example.test")).toThrow();
  });

  test("dateLabel : 10 premiers chars de l'ISO, chaîne courte = vide", () => {
    expect(tsDateLabel("2026-10-02T07:00:00.000Z")).toBe("2026-10-02");
    expect(tsDateLabel("2026-10")).toBe("");
  });

  test("Kotlin : fichiers présents, parse org.json, aucune interprétation (I6)", () => {
    for (const f of Object.values(K_FILES)) expect({ f, exists: existsSync(f) }).toEqual({ f, exists: true });
    const screen = codeOnly(readFileSync(K_FILES.screen, "utf8"));
    expect(screen).toContain("fun NewsScreen");
    expect(screen).toContain("Aucune actualité");
    expect(screen).toContain("fun NewsRoute");
    expect(screen).toContain("CachePolicy.NEWS");
    expect(screen).toContain("refreshAsync");
    expect(screen).toContain("newsFromPayload");
    for (const bad of ["WebView", "Html.fromHtml", "fromHtml", "loadData", "loadUrl", "setJavaScriptEnabled", "AnnotatedString.fromHtml"]) {
      expect({ bad, found: screen.includes(bad) }).toEqual({ bad, found: false });
    }
    const repo = codeOnly(readFileSync(K_FILES.repo, "utf8"));
    expect(repo).toContain('"/v1/news"');
    expect(repo).toContain("buildGet");
    expect(repo).toContain("org.json.JSONObject");
    expect(repo).toContain("isValid");
    for (const bad of ["WebView", "Html.fromHtml", "loadData", "setJavaScriptEnabled"]) {
      expect({ bad, found: repo.includes(bad) }).toEqual({ bad, found: false });
    }
    const core = readFileSync(K_FILES.core, "utf8");
    expect(core).toContain("fun isValid");
    expect(core).toContain("fun dateLabel");
    expect(core).toContain("fun readLabel");
    const config = readFileSync(K_FILES.config, "utf8");
    expect(config).toContain("/v1/news");
    const policy = readFileSync(K_FILES.policy, "utf8");
    expect(policy).toContain('const val NEWS = "news"');
    expect(policy).toContain("TTL_NEWS_MS");
    const synced = readFileSync(K_FILES.synced, "utf8");
    expect(synced).toContain("CachePolicy.NEWS");
    const nav = readFileSync(K_FILES.nav, "utf8");
    expect(nav).toContain("NewsRoute");
    // org.json vient du SDK : aucune ligne de dépendance ajoutée.
    for (const gradle of ["ui/build.gradle.kts", "data/build.gradle.kts", "core/build.gradle.kts"]) {
      const raw = readFileSync(join(ANDROID, gradle), "utf8");
      for (const dep of ["gson", "moshi", "kotlinx-serialization"]) {
        expect({ gradle, dep, found: raw.includes(dep) }).toEqual({ gradle, dep, found: false });
      }
    }
  });

  test("miroir TS et contrat : exactement les payloads que le Kotlin affiche", () => {
    for (const payload of [syntheticNewsOk, { news: [] }]) {
      expect(isNewsResponse(payload)).toBe(true);
      expect(tsNewsParse(JSON.stringify(payload)).every(tsNewsIsValid)).toBe(true);
      for (const item of tsNewsParse(JSON.stringify(payload))) {
        expect(isNewsItem({ ...syntheticNewsItem, ...item, accountId: syntheticNewsItem.accountId })).toBe(true);
      }
    }
  });
});

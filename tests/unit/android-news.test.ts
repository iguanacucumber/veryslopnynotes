import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isNewsItem, NEWS_BODY_MAX_CHARS, NEWS_META_MAX_CHARS, NEWS_TITLE_MAX_CHARS } from "../../shared/contracts/models";
import { isNewsResponse } from "../../shared/contracts/api";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { syntheticNewsInjectionItem, syntheticNewsItem, syntheticNewsOk } from "./fixtures/news";

// #144 : miroirs de la LOGIQUE PURE du rendu (NewsScreen.kt) — regroupement par
// catégorie, libellé de catégorie, ligne auteur + date RELATIVE. `now`/`zone`
// sont injectés côté Kotlin comme ici, sinon « il y a 4 min » dépend de l'horloge
// du téléphone et le test ne pourrait rien prouver.
const ZONE = "Europe/Paris";
/** 2026-10-02T09:00:00.000Z — deux heures après les deux publications du fixture. */
const NOW = Date.parse("2026-10-02T09:00:00.000Z");

/** Lecteur ISO du Kotlin (`homeMillisOf`) : `Z`, décalage, puis date seule. */
function tsIsoMillis(iso: string): number | null {
  const value = iso.trim();
  if (value === "") return null;
  const instant = Date.parse(value);
  if (Number.isFinite(instant)) return instant;
  const day = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(day) ? day : null;
}

/** Miroir de `relativeTimeFr` (PapComponents.kt), instance locale à now/zone. */
function tsRelative(epochMillis: number, now: number, timeZone: string = ZONE): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(epochMillis))) if (part.type !== "literal") p[part.type] = part.value;
  const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const clock = `${p.hour}:${p.minute}`;
  const np: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now))) {
    if (part.type !== "literal") np[part.type] = part.value;
  }
  const nowDay = Date.UTC(Number(np.year), Number(np.month) - 1, Number(np.day));
  if (Math.abs(epochMillis - now) < 60_000) return "à l'instant";
  const minutes = Math.floor(Math.abs(epochMillis - now) / 60_000);
  if (minutes < 60) return epochMillis < now ? `il y a ${minutes} min` : `dans ${minutes} min`;
  const hours = Math.floor(Math.abs(epochMillis - now) / 3_600_000);
  if (day === nowDay) return epochMillis < now ? `il y a ${hours} h` : `dans ${hours} h`;
  if (epochMillis < now && day === nowDay - 86_400_000) return `hier ${clock}`;
  const days = Math.abs(day - nowDay) / 86_400_000;
  if (days < 7) return epochMillis < now ? `il y a ${days} jours` : `dans ${days} jours`;
  return `${p.day}/${p.month}/${p.year}`;
}

const CATEGORY_OTHER = "Autres actualités";
const tsCategoryLabel = (category: string): string => category.trim() === "" ? CATEGORY_OTHER : category.trim();

/** Miroir de `newsGroups` : catégories triées par leur actualité la plus récente. */
function tsGroups(news: KtNewsItem[]): { category: string; items: KtNewsItem[] }[] {
  const buckets = new Map<string, KtNewsItem[]>();
  for (const item of news) {
    const key = tsCategoryLabel(item.category);
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  return [...buckets.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => (a.publishedAt === b.publishedAt ? (a.id < b.id ? -1 : 1) : a.publishedAt < b.publishedAt ? 1 : -1)),
    }))
    .sort((a, b) => {
      const first = a.items[0]?.publishedAt ?? "";
      const second = b.items[0]?.publishedAt ?? "";
      return first === second ? 0 : first < second ? 1 : -1;
    });
}

/** Miroir de `newsByline`. */
function tsByline(item: KtNewsItem, now: number, timeZone: string = ZONE): string {
  const epoch = tsIsoMillis(item.publishedAt);
  if (epoch === null) return "";
  const date = tsRelative(epoch, now, timeZone);
  const author = item.author.trim();
  return author === "" ? date : `Par ${author} · ${date}`;
}

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

  test("#144 : regroupement par catégorie, catégorie de repli, ordre stable", () => {
    const news = tsNewsFromPayload(JSON.stringify(syntheticNewsOk));
    // Le fixture a deux catégories différentes, une sans `category` du tout.
    const groups = tsGroups(news);
    expect(groups.map((g) => g.category)).toEqual(["Vie scolaire", CATEGORY_OTHER]);
    // Catégorie vide = REPLI nommé, jamais une chaîne vide en en-tête.
    expect(tsCategoryLabel("")).toBe(CATEGORY_OTHER);
    expect(tsCategoryLabel("   ")).toBe(CATEGORY_OTHER);
    expect(tsCategoryLabel(" Vie scolaire ")).toBe("Vie scolaire");
    // Une seule actualité par groupe dans ce fixture : rien à trier à l'intérieur.
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["n-fake-1"]);
    // Deux fois le même payload = exactement le même écran (pas de saut de ligne).
    expect(tsGroups(news)).toEqual(groups);
  });

  test("#144 : auteur et date en temps RELATIF, date illisible = pas de ligne", () => {
    const [first, second] = tsNewsFromPayload(JSON.stringify(syntheticNewsOk));
    // Fixture : première publiée le 02/10 à 07:00Z, seconde le 01/10 à 07:00Z ;
    // `now` = 02/10 09:00Z. Europe/Paris = UTC+2 en octobre.
    expect(tsByline(first!, NOW)).toBe("Par Vie scolaire · il y a 2 h");
    // La veille = heure locale (« hier 09:00 »), jamais un décompte d'heures.
    expect(tsByline(second!, NOW)).toBe("hier 09:00");
    // Auteur vide = la date seule (jamais « Par · … »).
    expect(tsByline({ ...first!, author: "  " }, NOW)).toBe("il y a 2 h");
    // Date illisible = AUCUNE ligne, plutôt qu'une date devinée.
    expect(tsByline({ ...first!, publishedAt: "pas-une-date" }, NOW)).toBe("");
    expect(tsByline({ ...first!, publishedAt: "" }, NOW)).toBe("");
    // Le fuseau décide du libellé : 23:30Z = 01:30 le 02/10 à Paris (donc
    // « aujourd'hui ») mais 23:30 le 01/10 en UTC (donc « hier »).
    const overnight = { ...first!, author: "", publishedAt: "2026-10-01T23:30:00.000Z" };
    expect(tsByline(overnight, NOW, ZONE)).toBe("il y a 9 h");
    expect(tsByline(overnight, NOW, "UTC")).toBe("hier 23:30");
  });

  test("#144 : la pastille non lu remplace le libellé texte « Non lu »", () => {
    const screen = codeOnly(readFileSync(K_FILES.screen, "utf8"));
    // Le texte « Lu » / « Non lu » ne doit plus être rendu comme état (il
    // restait dans le payload, jamais dans l'interface).
    expect(screen).not.toContain('"Non lu"');
    expect(screen).not.toContain('"Lu"');
    // Pastille + action « marquer comme lu », et le regroupement par catégorie.
    expect(screen).toContain("newsGroups(news)");
    expect(screen).toContain("Marquer comme lu");
    expect(screen).toContain("NEWS_CATEGORY_OTHER");
    expect(screen).toContain("PapSectionHeader(");
    // Pull-to-refresh : le MÊME composant que l'accueil, zéro dépendance.
    expect(screen).toContain("HomePullToRefresh(refreshing = loading");
    // Le contrat n'expose pas d'écriture de lecture : l'état lu est de session.
    expect(screen).toContain("var readIds by remember");
    // L'état vide Papillon et le bandeau horodaté.
    expect(screen).toContain('title = "Aucune actualité."');
    expect(screen).toContain("PapStaleBanner(fetchedAt = fetchedAt");
    expect(screen).toContain("PapErrorState(message = error");
    expect(screen).toContain("PapLoading()");
    // L'ancienne concaténation category · author · « Lu » a disparu.
    expect(screen).not.toContain("NewsItem.readLabel");
    // Aucune interprétation du contenu (I6) : les interdits de #79 restent.
    for (const bad of ["WebView", "Html.fromHtml", "fromHtml", "loadUrl", "setJavaScriptEnabled", "AnnotatedString"]) {
      expect({ bad, found: screen.includes(bad) }).toEqual({ bad, found: false });
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

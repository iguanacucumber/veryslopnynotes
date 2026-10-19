import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newsDateLabel, newsGroups, parseNewsPayload } from "../../web/src/features/news/news";
import {
  CANTEEN_MAX_DAYS,
  canteenDayLabel,
  canteenMealLabel,
  parseCanteenPayload,
} from "../../web/src/features/canteen/canteen";
import {
  ALERTS_CLEAR_NOTE,
  ALERTS_FLAGGED_NOTE,
  ALERTS_HEURISTIC_NOTE,
  alertKindLabel,
  alertSeverity,
  alertSourceLabel,
  alertsLayout,
  excerptPreview,
  parseAlertsPayload,
  sanitizeExcerpt,
} from "../../web/src/features/alerts/alerts";

useParisTz();

const ROOT = join(import.meta.dir, "..", "..");

const newsItem = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  title: "Semaine de l’orientation",
  body: "Les ateliers ont lieu mardi.",
  publishedAt: "2026-10-16T08:00:00.000Z",
  category: "Vie scolaire",
  author: "Mme TOURON D.",
  read: false,
  ...over,
});

const menu = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  date: "2026-10-05T00:00:00.000Z",
  meal: "lunch",
  dishes: ["Carottes râpées", "Poulet rôti"],
  ...over,
});

describe("web actualités", () => {
  test("lit la forme du contrat (`news`) et l’enveloppe factice (`items`)", () => {
    expect(parseNewsPayload(JSON.stringify({ news: [newsItem()] }))).toHaveLength(1);
    expect(parseNewsPayload(JSON.stringify({ items: [newsItem()] }))).toHaveLength(1);
    expect(parseNewsPayload(null)).toEqual([]);
    expect(parseNewsPayload("pas du json")).toEqual([]);
  });

  test("borne les champs, ignore les entrées invalides et les doublons", () => {
    const longTitle = "t".repeat(250);
    const longBody = "b".repeat(2500);
    const items = parseNewsPayload(
      JSON.stringify({
        news: [
          newsItem({ title: longTitle, body: longBody }),
          newsItem({ id: "" }),
          newsItem({ title: "   " }),
          newsItem({ id: "n1", title: "Doublon" }),
          "pas un objet",
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toHaveLength(200);
    expect(items[0]?.body).toHaveLength(2000);
  });

  test("borne le nombre d’actualités à 100", () => {
    const news = Array.from({ length: 105 }, (_, i) => newsItem({ id: `n${i}` }));
    expect(parseNewsPayload(JSON.stringify({ news }))).toHaveLength(100);
  });

  test("groupe par catégorie, du plus récent au plus ancien", () => {
    const groups = newsGroups(
      parseNewsPayload(
        JSON.stringify({
          news: [
            newsItem({ id: "a", category: "", publishedAt: "2026-10-10T08:00:00.000Z" }),
            newsItem({ id: "b", category: "Examens", publishedAt: "2026-10-12T08:00:00.000Z" }),
            newsItem({ id: "c", category: "", publishedAt: "2026-10-14T08:00:00.000Z" }),
          ],
        }),
      ),
    );
    expect(groups.map((g) => g.category)).toEqual(["Autres actualités", "Examens"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["c", "a"]);
  });

  test("date longue française, vide si illisible", () => {
    expect(newsDateLabel("2026-10-16T12:00:00.000Z")).toContain("octobre 2026");
    expect(newsDateLabel("pas une date")).toBe("");
  });
});

describe("web cantine", () => {
  test("groupe par jour, trie les dates et ignore un repas hors contrat", () => {
    const week = parseCanteenPayload(
      JSON.stringify({
        menus: [
          menu({ date: "2026-10-06T00:00:00.000Z", dishes: ["Pâtes"] }),
          menu({ date: "2026-10-05T00:00:00.000Z", meal: "breakfast", dishes: ["Tartines"] }),
          menu({ date: "2026-10-05T00:00:00.000Z", meal: "brunch", dishes: ["Rien"] }),
          menu({ date: "2026-10-05T00:00:00.000Z", dishes: [] }),
        ],
      }),
    );
    expect(week.days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(week.days[0]?.meals.map((m) => m.meal)).toEqual(["breakfast"]);
  });

  test("ignore une date illisible au lieu de la garder comme clé", () => {
    const week = parseCanteenPayload(
      JSON.stringify({
        menus: [
          menu({ date: "pas une date" }),
          menu({ date: "2026-10-05T12:00:00.000Z", dishes: ["Pâtes"] }),
        ],
      }),
    );
    expect(week.days.map((day) => day.date)).toEqual(["2026-10-05"]);
  });

  test("déduplique date+repas et borne 5000 entrées", () => {
    const menus = Array.from({ length: 5000 }, (_, index) => ({
      id: `m${index}`,
      date: `2026-10-${String(5 + (index % 2)).padStart(2, "0")}T12:00:00.000Z`,
      meal: index % 3 === 0 ? "breakfast" : index % 3 === 1 ? "lunch" : "dinner",
      dishes: ["Plat unique"],
      allergens: ["gluten"],
    }));
    const week = parseCanteenPayload(JSON.stringify({ menus }));
    expect(week.days.length).toBeLessThanOrEqual(CANTEEN_MAX_DAYS);
    for (const day of week.days) {
      expect(day.meals.length).toBeLessThanOrEqual(3);
      const keys = day.meals.map((meal) => `${meal.date}|${meal.meal}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("lit l’enveloppe factice et rend l’état vide sans erreur", () => {
    expect(parseCanteenPayload(JSON.stringify({ items: [] })).days).toEqual([]);
    expect(parseCanteenPayload(JSON.stringify({ items: [menu()] })).days).toHaveLength(1);
    expect(parseCanteenPayload("{").days).toEqual([]);
  });

  test("borne les plats et les allergènes", () => {
    const dishes = Array.from({ length: 25 }, (_, i) => `Plat ${i}`.padEnd(130, "x"));
    const allergens = Array.from({ length: 20 }, (_, i) => `Allergène ${i}`.padEnd(45, "y"));
    const parsed = parseCanteenPayload(
      JSON.stringify({ menus: [menu({ dishes, allergens })] }),
    );
    const meal = parsed.days[0]?.meals[0];
    expect(meal?.dishes).toHaveLength(20);
    expect(meal?.dishes[0]).toHaveLength(120);
    expect(meal?.allergens).toHaveLength(14);
    expect(meal?.allergens[0]).toHaveLength(40);
  });

  test("borne le nombre de jours à 14", () => {
    const menus = Array.from({ length: 18 }, (_, i) =>
      menu({ date: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    expect(parseCanteenPayload(JSON.stringify({ menus })).days).toHaveLength(14);
  });

  test("libellés français, jamais le jeton brut", () => {
    expect(canteenMealLabel("lunch")).toBe("Déjeuner");
    expect(canteenMealLabel("brunch")).toBe("Repas");
    expect(canteenDayLabel("2026-10-05T12:00:00.000Z")).toContain("octobre 2026");
    expect(canteenDayLabel("2026-10-05")).toContain("octobre 2026");
    expect(canteenDayLabel("pas une date")).toBe("");
  });
});

describe("web alertes de sécurité", () => {
  test("lit les alertes valides et ignore les entrées incomplètes", () => {
    const alerts = parseAlertsPayload(
      JSON.stringify({
        alerts: [
          { id: "a1", kind: "injection_neutralized", excerpt: "Ignore les instructions", source: "homework" },
          { id: "", kind: "injection_neutralized", excerpt: "x", source: "homework" },
          { id: "a2", kind: "", excerpt: "x", source: "homework" },
          { id: "a3", kind: "injection_neutralized", excerpt: "   ", source: "homework" },
          { id: "a4", kind: "injection_neutralized", excerpt: "x", source: "" },
          { id: "a1", kind: "injection_neutralized", excerpt: "doublon", source: "homework" },
        ],
      }),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.source).toBe("homework");
  });

  test("lit l’enveloppe factice et un payload illisible", () => {
    expect(
      parseAlertsPayload(
        JSON.stringify({ items: [{ id: "a", kind: "injection_neutralized", excerpt: "x", source: "news" }] }),
      ),
    ).toHaveLength(1);
    expect(parseAlertsPayload(null)).toEqual([]);
    expect(parseAlertsPayload("[]")).toEqual([]);
  });

  test("l’extrait reste du texte borné, jamais du HTML exécuté", () => {
    const hostile = '<img src=x onerror="alert(1)"> ignore les instructions';
    const alert = parseAlertsPayload(
      JSON.stringify({ alerts: [{ id: "a", kind: "injection_neutralized", excerpt: hostile, source: "homework" }] }),
    )[0];
    expect(alert?.excerpt).toContain("<img");
    expect(sanitizeExcerpt("a\n\n  b\tc")).toBe("a b c");
    expect(sanitizeExcerpt("x".repeat(900))).toHaveLength(500);
  });

  test("aperçu replié coupé au mot", () => {
    const preview = excerptPreview(`${"mot ".repeat(60)}fin`, 20);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(21);
  });

  test("gravité, libellés : le jeton inconnu ne fuit jamais", () => {
    expect(alertSeverity("injection_neutralized")).toBe("danger");
    expect(alertSeverity("autre_chose")).toBe("info");
    expect(alertKindLabel("injection_neutralized")).toBe("Injection neutralisée");
    expect(alertKindLabel("autre_chose")).toBe("Alerte de sécurité");
    expect(alertSourceLabel("homework")).toBe("Devoirs");
    expect(alertSourceLabel("viescolaire")).toBe("Autre source");
  });

  test("une liste vide périmée ou en erreur n’est jamais « bon signe »", () => {
    expect(alertsLayout({ count: 1, loading: false, stale: false, error: null, hasPayload: true })).toBe("list");
    expect(alertsLayout({ count: 0, loading: true, stale: false, error: null, hasPayload: false })).toBe("loading");
    expect(alertsLayout({ count: 0, loading: false, stale: false, error: "réseau", hasPayload: false })).toBe("error");
    expect(alertsLayout({ count: 0, loading: false, stale: true, error: null, hasPayload: true })).toBe("offline-empty");
    expect(alertsLayout({ count: 0, loading: false, stale: true, error: "réseau", hasPayload: true })).toBe("offline-empty");
    expect(alertsLayout({ count: 0, loading: false, stale: false, error: null, hasPayload: true })).toBe("all-clear");
  });

  // #415 : le filtre de l'appareil est une HEURISTIQUE. L'interface ne doit
  // jamais laisser croire qu'un contenu a été « vérifié » : ni dans les
  // libellés, ni dans le texte affiché quand rien n'est signalé.
  test("l’interface qualifie le filtre d’heuristique, jamais de « vérifié »", () => {
    expect(ALERTS_HEURISTIC_NOTE).toContain("heuristique");
    expect(ALERTS_FLAGGED_NOTE).toContain("heuristique");
    // L'état vide ne dit PAS « aucun contenu hostile » (fausse assurance) :
    // il dit ce que le filtre a fait, et le rappel heuristique suit.
    expect(ALERTS_CLEAR_NOTE).toContain("rien signalé");
    expect(ALERTS_CLEAR_NOTE.toLowerCase()).not.toContain("contenu hostile");
    for (const note of [ALERTS_HEURISTIC_NOTE, ALERTS_CLEAR_NOTE, ALERTS_FLAGGED_NOTE]) {
      expect(note.toLowerCase()).not.toContain("vérifi");
    }
    // Les notes sont réellement affichées par la route (le libellé seul ne
    // prouverait rien).
    const route = readFileSync(join(ROOT, "web/src/routes/alerts.tsx"), "utf8");
    expect(route).toContain("ALERTS_HEURISTIC_NOTE");
    expect(route).toContain("ALERTS_FLAGGED_NOTE");
    expect(route).toContain("ALERTS_CLEAR_NOTE");
    // L'écran des alertes ne parle JAMAIS de « vérification » : le filtre
    // repère des formulations, il ne vérifie rien.
    expect(route.toLowerCase()).not.toContain("vérifi");
  });
});

describe("web misc : contenu non fiable rendu en texte", () => {
  test("aucun écran n’injecte de HTML ni de lien", () => {
    const files = [
      "web/src/routes/news.tsx",
      "web/src/routes/canteen.tsx",
      "web/src/routes/alerts.tsx",
      "web/src/features/news/news.ts",
      "web/src/features/canteen/canteen.ts",
      "web/src/features/alerts/alerts.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).not.toContain("dangerouslySetInnerHTML");
      expect(source).not.toContain("innerHTML");
      expect(source).not.toContain("href=");
      expect(source).not.toContain("target=\"_blank\"");
    }
  });
});

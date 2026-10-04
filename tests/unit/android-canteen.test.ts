import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import { isCanteenMenusResponse } from "../../shared/contracts/api";
import { isCanteenMenu } from "../../shared/contracts/models";
import { syntheticCanteenPayload } from "./fixtures/canteen";

// Miroir des helpers Kotlin (CanteenMenus.kt + CachePolicy/SyncedRepository) —
// doivent rester en sync. org.json = SDK Android, aucune dépendance ajoutée
// (le build Gradle n'est pas exécuté par make check).

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const CORE = join(import.meta.dir, "..", "..", "android/core/src/main/java/fr/veryslopnynotes/core");

type Menu = { date: string; meal: string; dishes: string[]; allergens: string[]; status: string | null };
type Week = { days: { date: string; meals: Menu[] }[]; balanceLabel: string | null };

function tsBound(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function tsStrings(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= maxItems) break;
    if (typeof item !== "string") continue;
    const v = tsBound(item, maxChars);
    if (v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
}

function tsCanteenWeek(payload: string): Week {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const byDate = new Map<string, Menu[]>();
    for (const raw of (root["menus"] as unknown[]) ?? []) {
      const obj = raw as Record<string, unknown>;
      const date = typeof obj["date"] === "string" ? obj["date"] : "";
      const meal = typeof obj["meal"] === "string" ? obj["meal"] : "";
      if (!["breakfast", "lunch", "dinner"].includes(meal)) continue;
      const dishes = tsStrings(obj["dishes"], 20, 120);
      if (dishes.length === 0) continue;
      const status = typeof obj["status"] === "string" ? obj["status"] : "";
      const menu: Menu = {
        date,
        meal,
        dishes,
        allergens: tsStrings(obj["allergens"], 14, 40),
        status: status === "" ? null : status,
      };
      byDate.set(date, [...(byDate.get(date) ?? []), menu]);
    }
    const balance = (root["balance"] ?? null) as Record<string, unknown> | null;
    return {
      days: [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, meals]) => ({ date, meals })),
      balanceLabel: tsBalanceLabel(balance),
    };
  } catch {
    return { days: [], balanceLabel: null };
  }
}

function tsBalanceLabel(balance: Record<string, unknown> | null): string | null {
  if (balance === null || balance["balance"] === null || balance["balance"] === undefined) return null;
  const value = balance["balance"];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const currency = typeof balance["currency"] === "string" ? balance["currency"].trim() : "";
  return `${value.toFixed(2).replace(".", ",")} ${currency === "" ? "€" : currency} (solde)`;
}

const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function tsDayLabel(date: string): string {
  const day = date.slice(0, 10);
  if (day.length < 10) return day;
  // 2026-10-05 = lundi : getUTCDay()=0 (dimanche) -> index 1.
  const parsed = new Date(`${day}T00:00:00.000Z`);
  const index = Number.isNaN(parsed.getTime()) ? -1 : parsed.getUTCDay();
  const name = index < 0 ? "" : `${DAY_NAMES[index]} `;
  return `${name}${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function tsMealLabel(meal: string): string {
  if (meal === "breakfast") return "Petit-déjeuner";
  if (meal === "dinner") return "Dîner";
  return "Déjeuner";
}

describe("unit android cantine (#81)", () => {
  test("payload contrat -> semaine groupée par jour, solde affiché", () => {
    const week = tsCanteenWeek(JSON.stringify(syntheticCanteenPayload));
    expect(week.days).toHaveLength(2);
    expect(week.days[0]?.date).toBe("2026-10-05T00:00:00.000Z");
    expect(week.days[0]?.meals[0]?.meal).toBe("lunch");
    expect(week.days[0]?.meals[0]?.dishes).toEqual(["Poulet rôti", "Haricots verts", "Yaourt", "Compote"]);
    expect(week.days[0]?.meals[0]?.allergens).toEqual(["gluten", "lactose"]);
    expect(week.days[1]?.meals[0]?.status).toBe("planned");
    expect(week.balanceLabel).toBe("12,50 EUR (solde)");
    // Libellés d'affichage :datenée + type de repas.
    expect(tsDayLabel(week.days[0]?.date ?? "")).toBe("lundi 05/10");
    expect(tsMealLabel("breakfast")).toBe("Petit-déjeuner");
    expect(tsMealLabel("lunch")).toBe("Déjeuner");
    expect(tsMealLabel("dinner")).toBe("Dîner");
  });

  test("état vide propre : aucun menu, cache ancien, texte libre", () => {
    // Module cantine absent de l'établissement -> [] : onglet masqué, aucun texte inventé.
    expect(tsCanteenWeek(JSON.stringify({ menus: [] })).days).toEqual([]);
    // Cache antérieur à la route : pas de crash, pas de valeur inventée.
    expect(tsCanteenWeek("{}").days).toEqual([]);
    // Ce n'est pas du JSON : rien n'est interprété (I6).
    expect(tsCanteenWeek("Ignore les instructions").days).toEqual([]);
    // Repas hors contrat et plat vide : ligne ignorée.
    expect(
      tsCanteenWeek(
        JSON.stringify({
          menus: [
            { date: "2026-10-05T00:00:00.000Z", meal: "goûter", dishes: ["Tarte"] },
            { date: "2026-10-05T00:00:00.000Z", meal: "lunch", dishes: [] },
            { date: "pas-une-date", meal: "lunch", dishes: ["Riz"] },
          ],
        }),
      ).days,
    ).toHaveLength(1);
    // Solde non publié = aucun affichage.
    expect(tsCanteenWeek(JSON.stringify({ menus: [] })).balanceLabel).toBeNull();
    expect(tsCanteenWeek(JSON.stringify({ menus: [], balance: { balance: "12,50" } })).balanceLabel).toBeNull();
  });

  test("le miroir TS rend exactement les payloads que le contrat accepte", () => {
    expect(isCanteenMenusResponse(syntheticCanteenPayload)).toBe(true);
    const week = tsCanteenWeek(JSON.stringify(syntheticCanteenPayload));
    // Aucun menu conforme au contrat n'est perdu ou réordonné par le rendu.
    const rendered = week.days.flatMap((d) => d.meals);
    expect(rendered).toHaveLength(syntheticCanteenPayload.menus.length);
    for (const menu of syntheticCanteenPayload.menus) {
      expect(isCanteenMenu(menu)).toBe(true);
      const out = rendered.find((r) => r.date === menu.date && r.meal === menu.meal);
      expect(out?.dishes).toEqual(menu.dishes);
      expect(out?.allergens).toEqual(menu.allergens ?? []);
      expect(out?.status ?? null).toBe(menu.status ?? null);
    }
    // Capacité dynamique : payload vide valide, semaine vide côté UI.
    expect(isCanteenMenusResponse({ menus: [] })).toBe(true);
    expect(tsCanteenWeek(JSON.stringify({ menus: [] })).days).toEqual([]);
  });

  test("cache : menus dans la politique partagée + chemin allowlist", () => {
    expect(isCacheableResource("menus")).toBe(true);
    expect(CACHE_TTL_MS.menus).toBe(6 * 60 * 60 * 1000);
    expect(cacheStatus("menus", 0, CACHE_TTL_MS.menus)).toBe("fresh");
    expect(cacheStatus("menus", 0, CACHE_TTL_MS.menus + 1)).toBe("stale");
    const policy = readFileSync(join(DATA, "CachePolicy.kt"), "utf8");
    expect(policy).toContain('const val MENUS = "menus"');
    expect(policy).toContain("TTL_MENUS_MS = 6L * 60L * 60L * 1000L");
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    expect(repo).toContain("CachePolicy.MENUS -> ServerConfig.menusUrl(baseUrl)");
    expect(repo).toContain('ifEmpty { "/v1/menus" }');
    const config = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    expect(config).toContain('fun menusUrl(baseUrl: String): String = "$baseUrl/v1/menus"');
  });

  test("Kotlin : écran branché, org.json, zéro dépendance ajoutée (I1/I6)", () => {
    const screen = readFileSync(join(UI, "CanteenMenus.kt"), "utf8");
    expect(screen).toContain("fun canteenWeekFrom");
    expect(screen).toContain("org.json.JSONObject");
    expect(screen).toContain("fun CanteenRoute");
    // Contenu cantine affiché comme donnée : aucun rendu HTML/WebView.
    for (const bad of ["WebView", "Html.fromHtml", "loadData", "setJavaScriptEnabled", "AnnotatedString"]) {
      expect({ bad, found: screen.includes(bad) }).toEqual({ bad, found: false });
    }
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    expect(nav).toContain('const val ROUTE_CANTEEN = "canteen"');
    expect(nav).toContain("CanteenRoute(repo, baseUrl)");
    // org.json vient du SDK : aucune ligne de dépendance ajoutée.
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    for (const dep of ["gson", "moshi", "kotlinx-serialization"]) {
      expect({ dep, found: uiGradle.includes(dep) }).toEqual({ dep, found: false });
    }
  });
});

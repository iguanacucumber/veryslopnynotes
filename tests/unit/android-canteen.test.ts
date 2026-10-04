import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import { isCanteenMenusResponse } from "../../shared/contracts/api";
import { isCanteenMenu } from "../../shared/contracts/models";
import { syntheticCanteenPayload } from "./fixtures/canteen";
import { dayLabelFr } from "./fixtures/date-fr";
import { enumFr } from "./fixtures/enum-fr";

// Miroir des helpers Kotlin (CanteenMenus.kt + CachePolicy/SyncedRepository) —
// doivent rester en sync. org.json = SDK Android, aucune dépendance ajoutée
// (le build Gradle n'est pas exécuté par make check).

const ZONE = "Europe/Paris";
/** 2026-10-05T09:00:00.000Z : le relevé du fixture (07:00Z) a donc 2 h. */
const NOW = Date.parse("2026-10-05T09:00:00.000Z");

/** Sous-ensemble de `relativeTimeFr` (PapComponents.kt) : ce qu'il faut ici. */
function tsRelative(epochMillis: number, now: number, timeZone: string = ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(epochMillis));
  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const np: Record<string, string> = {};
  for (const part of nowParts) if (part.type !== "literal") np[part.type] = part.value;
  const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const nowDay = Date.UTC(Number(np.year), Number(np.month) - 1, Number(np.day));
  const gap = Math.abs(epochMillis - now);
  const past = epochMillis < now;
  if (gap < 60_000) return "à l'instant";
  const minutes = Math.floor(gap / 60_000);
  if (minutes < 60) return past ? `il y a ${minutes} min` : `dans ${minutes} min`;
  const hours = Math.floor(gap / 3_600_000);
  if (day === nowDay) return past ? `il y a ${hours} h` : `dans ${hours} h`;
  const clock = `${p.hour}:${p.minute}`;
  if (past && day === nowDay - 86_400_000) return `hier ${clock}`;
  const days = Math.abs(day - nowDay) / 86_400_000;
  if (days < 7) return past ? `il y a ${days} jours` : `dans ${days} jours`;
  return `${p.day}/${p.month}/${p.year}`;
}

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
/** Sans les commentaires : une garde de source ne doit pas confondre un `//` qui
 *  NOMME un défaut avec le défaut lui-même. */
const codeOnly = (c: string): string =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
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

// #144 : l'horloge est INJECTÉE comme côté Kotlin (`canteenWeekFrom(payload, now,
// zone)`), sinon l'âge du solde dépendrait de la machine qui lance le test.
function tsCanteenWeek(payload: string, now: number = NOW, timeZone: string = ZONE): Week {
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
      balanceLabel: tsBalanceLine(balance, now, timeZone),
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

/**
 * Miroir de `canteenBalanceLine` (#144) : le montant SEUL, puis le montant daté.
 * `updatedAt` était parsé puis jeté avant #144 — donc l'âge du solde n'était
 * jamais montré.
 */
function tsBalanceLine(
  balance: Record<string, unknown> | null,
  now: number,
  timeZone: string = ZONE,
): string | null {
  const label = tsBalanceLabel(balance);
  if (label === null) return null;
  const updatedAt = typeof balance?.["updatedAt"] === "string" ? (balance["updatedAt"] as string).trim() : "";
  const epoch = Date.parse(updatedAt);
  if (!Number.isFinite(epoch)) return label;
  return `${label} · mis à jour ${tsRelative(epoch, now, timeZone)}`;
}

/**
 * Miroir de `canteenStatusLabel` / `canteenMealLabel` (#147) : les deux délèguent
 * à `core/EnumFr.kt`, donc le jeton anglais ne sort JAMAIS en clair et un repas
 * hors contrat ne devient PAS un déjeuner.
 */
const tsStatusLabel = (status: string | null): string | null =>
  status === null || status === "" ? null : enumFr(status, "Statut inconnu");

// #147 : `dayLabelFr` vient du miroir partagé (table lue dans `core/DateFr.kt`).
const tsDayLabel = dayLabelFr;

const tsMealLabel = (meal: string): string => enumFr(meal, "Repas");

describe("unit android cantine (#81)", () => {
  test("payload contrat -> semaine groupée par jour, solde affiché", () => {
    const week = tsCanteenWeek(JSON.stringify(syntheticCanteenPayload));
    expect(week.days).toHaveLength(2);
    expect(week.days[0]?.date).toBe("2026-10-05T00:00:00.000Z");
    expect(week.days[0]?.meals[0]?.meal).toBe("lunch");
    expect(week.days[0]?.meals[0]?.dishes).toEqual(["Poulet rôti", "Haricots verts", "Yaourt", "Compote"]);
    expect(week.days[0]?.meals[0]?.allergens).toEqual(["gluten", "lactose"]);
    expect(week.days[1]?.meals[0]?.status).toBe("planned");
    // #144 : le solde porte son âge (« updatedAt » était parsé puis jeté).
    expect(week.balanceLabel).toBe("12,50 EUR (solde) · mis à jour il y a 2 h");
    // Libellés d'affichage :datenée + type de repas.
    expect(tsDayLabel(week.days[0]?.date ?? "")).toBe("lundi 05/10");
    expect(tsMealLabel("breakfast")).toBe("Petit-déjeuner");
    expect(tsMealLabel("lunch")).toBe("Déjeuner");
    expect(tsMealLabel("dinner")).toBe("Dîner");
    // #147 : un repas hors contrat ne devient PAS un déjeuner (« Déjeuner » par
    // défaut, c'était inventer un menu que l'établissement n'a pas publié).
    expect(tsMealLabel("goûter")).toBe("Repas");
  });

  test("#144 : statut traduit et coloré, jamais le jeton anglais", () => {
    expect(tsStatusLabel("served")).toBe("Servi");
    expect(tsStatusLabel("planned")).toBe("Prévu");
    // Absent = établissement qui ne publie pas de statut : aucun libellé.
    expect(tsStatusLabel(null)).toBeNull();
    expect(tsStatusLabel("")).toBeNull();
    // Jeton inconnu = « Statut inconnu », JAMAIS le jeton brut en clair.
    // #147 : `cancelled` est connu du CONTRAT (c'est un statut de cours de
    // `TIMETABLE_STATUSES`) : la table est plate — un seul endroit à tenir à
    // jour — donc un jeton d'un autre enum y est traduit lui aussi. Ce qui reste
    // vrai, c'est la règle qui compte : rien ne sort jamais en clair.
    expect(tsStatusLabel("cancelled")).toBe("Annulé");
    // Jeton absent du contrat entier = le repli du caller, jamais le jeton.
    expect(tsStatusLabel("eating")).toBe("Statut inconnu");
    expect(tsStatusLabel("SERVING")).toBe("Statut inconnu");
    const kt = codeOnly(readFileSync(join(UI, "CanteenMenus.kt"), "utf8"));
    // #147 : la traduction est dans la table UNIQUE du contrat, plus aucun
    // `when` par écran ; l'écran garde le jeton pour la COULEUR, qui doit décider
    // sur le contrat et pas sur une chaîne de libellé.
    expect(kt).toContain("enumFr(status, CANTEEN_STATUS_UNKNOWN)");
    expect(kt).toContain('const val STATUS_SERVED = "served"');
    expect(kt).toContain('const val STATUS_PLANNED = "planned"');
    expect(kt).toContain("STATUS_SERVED -> MaterialTheme.colorScheme.primary");
    expect(kt).toContain("STATUS_PLANNED -> MaterialTheme.colorScheme.tertiary");
    // La pastille ne colore plus par comparaison de libellés français.
    expect(kt).not.toContain('"Servi" -> MaterialTheme');
    // Aucune interpolation brute du statut dans une phrase (le défaut #144).
    expect(kt).not.toContain("(${menu.status})");
    expect(kt).not.toContain("allergènes :");
    // La couleur passe par une pastille, donc par le thème.
    expect(kt).toContain("PapPill(text = label, color = statusColor)");
    expect(kt).toContain("MaterialTheme.colorScheme.primary");
    expect(kt).toContain("MaterialTheme.colorScheme.tertiary");
  });

  test("#144 : allergènes en BLOC dédié, plus une fin de ligne", () => {
    const kt = codeOnly(readFileSync(join(UI, "CanteenMenus.kt"), "utf8"));
    // Bloc titré, avant les plats, sur un aplat — pas un « — allergènes : … ».
    expect(kt).toContain("CanteenAllergenBlock(menu.allergens)");
    expect(kt).toContain('text = "ALLERGÈNES"');
    expect(kt).toContain("ALERGEN_BLOCK_ALPHA");
    // Une étiquette par allergène, donc rien à déchiffrer.
    expect(kt).toContain('text = "• $allergen"');
    // Le solde est daté, le jour aussi (cartes groupées par jour).
    expect(kt).toContain('· mis à jour ${relativeTimeFr(epoch, now, zone)}');
    expect(kt).toContain("CanteenDayCard(day)");
    expect(kt).toContain("CanteenBalanceCard(balance)");
    // Zéro hex en dur : les couleurs viennent du thème.
    expect(kt).not.toMatch(/Color\(0x[0-9A-Fa-f]{8}L\)/);
  });

  test("#144 : solde sans solde, sans date, date illisible", () => {
    // Solde absent = rien n'est affiché (rien d'inventé).
    expect(tsBalanceLine(null, NOW)).toBeNull();
    expect(tsBalanceLine({ balance: "12,50" }, NOW)).toBeNull();
    // Solde sans `updatedAt` = le montant seul, jamais une date devinée.
    expect(tsBalanceLine({ balance: 1, currency: "EUR" }, NOW)).toBe("1,00 EUR (solde)");
    // `updatedAt` illisible = idem.
    expect(tsBalanceLine({ balance: 1, currency: "EUR", updatedAt: "hier" }, NOW)).toBe("1,00 EUR (solde)");
    // Date lisible = datée, donc l'utilisateur sait dater son solde.
    expect(tsBalanceLine({ balance: 1, currency: "EUR", updatedAt: "2026-10-05T07:00:00.000Z" }, NOW)).toBe(
      "1,00 EUR (solde) · mis à jour il y a 2 h",
    );
    // Un relevé de la veille s'affiche comme tel, pas comme un chiffre orphelin.
    expect(tsBalanceLine({ balance: 1, currency: "EUR", updatedAt: "2026-10-04T07:00:00.000Z" }, NOW)).toBe(
      "1,00 EUR (solde) · mis à jour hier 09:00",
    );
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

import { expect, test, type Locator, type Page } from "@playwright/test";
import axe from "axe-core";
import { mockCall } from "../../web/src/bridge/mock";
import { SMOKE_ROUTES } from "../../web/src/smoke-routes";

/** Horloge figée : les routes affichent des dates et des libellés relatifs
 *  (« il y a 2 jours », « cette semaine »). Sans elle, une baseline change
 *  chaque jour sans qu'une ligne de code ait bougé. */
const FIXED_TIME = new Date("2026-01-14T09:30:00.000+01:00");

/** WCAG 2.0 → 2.2, niveaux A et AA. `color-contrast` est explicitement activé
 *  par `scannerAxe`, même si WCAG 2 AA le demande déjà. */
const TAGS_AXE = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"] as const;

/** Éléments dont le texte dépend du temps ou d'un « maintenant » : la capture
 *  les masque en plus de l'horloge figée. */
const MASQUES = [
  "time",
  ".week-nav__detail",
  ".tt-day__subtitle",
  ".tt-now",
  ".home-task__due",
  ".messages-card__date",
  ".grades-latest__date",
  ".revision-card__meta",
  ".news-card__date",
] as const;

/** Emoji de matière : la fonte emoji n'est pas vendoriée, sa largeur change
 *  avec le système. On leur donne une boîte fixe et on les cache : la
 *  géométrie de la carte reste comparable, sans glyphe dépendant du runner. */
const STYLE_EMOJI = `
  .grades-latest__emoji,
  .grades-subject__emoji,
  .home-task__emoji,
  .task-card__emoji,
  .hw-context__emoji {
    visibility: hidden !important;
    flex: 0 0 24px !important;
    width: 24px !important;
    height: 24px !important;
    font-size: 0 !important;
    line-height: 0 !important;
  }
`;

const BRIDGE_FACTICE = `
  window.VSN = {
    call(requestId, method, paramsJson) {
      let params = {};
      try { params = paramsJson ? JSON.parse(paramsJson) : {}; } catch (e) { params = {}; }
      window.__vsnMock(method, params).then(
        (value) => window.__vsnResolve?.(requestId, JSON.stringify(value ?? null)),
        (error) => window.__vsnReject?.(requestId, JSON.stringify({ code: "unknown", message: String(error) })),
      );
    },
  };
`;

const pontsInstalles = new WeakSet<Page>();

async function installerPont(page: Page): Promise<void> {
  if (pontsInstalles.has(page)) return;
  await page.exposeFunction("__vsnMock", (method: string, params: unknown) =>
    mockCall(method, params),
  );
  await page.addInitScript(BRIDGE_FACTICE);
  pontsInstalles.add(page);
}

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
}

interface AxeResults {
  violations: Violation[];
}

function formaterViolations(route: string, theme: string, violations: Violation[]): string {
  return [
    `${route} (${theme}) : ${violations.length} violation(s) axe`,
    ...violations.map(
      (v) =>
        `  [${v.impact ?? "n/a"}] ${v.id} — ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(" ")}`).join("\n"),
    ),
  ].join("\n");
}

async function ouvrir(page: Page, route: string, dark: boolean): Promise<void> {
  await installerPont(page);
  // L'init script pose le thème AVANT `theme-bootstrap.js` : pas de flash ni de
  // course entre le rendu et la préférence.
  await page.addInitScript(
    (sombre: boolean) => localStorage.setItem("vsn:theme", sombre ? "DARK" : "LIGHT"),
    dark,
  );
  await page.clock.setFixedTime(FIXED_TIME);
  // Deuxième ouverture (thème sombre) : la même URL ne déclenche pas de
  // navigation d'URL à URL ; un reload rejoue les init scripts, dont le thème.
  if (page.url() === "about:blank") {
    await page.goto(`/#${route}`, { waitUntil: "networkidle" });
  } else {
    await page.reload({ waitUntil: "networkidle" });
  }
  await expect(page.locator("main")).toHaveCount(1);
  await page.locator("h1, h2, strong").first().waitFor();
  // Le spinner est un ÉVÉNEMENT : on attend sa disparition, pas une durée fixe.
  await page.waitForFunction(() => !document.querySelector(".spinner")).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: STYLE_EMOJI });
  // Deux frames : la dernière mutation de layout est peinte avant la mesure.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await page.evaluate(() => document.documentElement.dataset["theme"])).toBe(
    dark ? "dark" : "light",
  );
}

async function scannerAxe(page: Page): Promise<Violation[]> {
  // `evaluate` traverse CDP hors CSP (`script-src 'self'`) ; un addScriptTag
  // inline serait refusé par la politique du document.
  await page.evaluate(axe.source);
  const results = await page.evaluate(
    async ({ tags }: { tags: readonly string[] }): Promise<AxeResults> => {
      const api = (
        window as unknown as {
          axe: {
            run: (
              context: Document,
              options: {
                runOnly: { type: "tag"; values: readonly string[] };
                rules: { "color-contrast": { enabled: boolean } };
              },
            ) => Promise<AxeResults>;
          };
        }
      ).axe;
      return api.run(document, {
        runOnly: { type: "tag", values: tags },
        rules: { "color-contrast": { enabled: true } },
      });
    },
    { tags: TAGS_AXE },
  );
  return results.violations;
}

interface Couleurs {
  page: string;
  surface: string;
  ink: string;
  brandDeep: string;
  brandSolid: string;
  onBrand: string;
  dangerInk: string;
}

/** Lit les variables RÉELLEMENT appliquées (le thème est posé en JS) et rend
 *  les couleurs résolues, pas les jetons bruts de `tokens.css`. */
async function couleursAppliquees(page: Page): Promise<Couleurs> {
  return page.evaluate(() => {
    const sonde = document.createElement("span");
    sonde.style.display = "none";
    document.body.append(sonde);
    const lire = (nom: string): string => {
      sonde.style.color = `var(${nom})`;
      return getComputedStyle(sonde).color;
    };
    const couleurs = {
      page: lire("--page"),
      surface: lire("--surface"),
      ink: lire("--ink"),
      brandDeep: lire("--brand-deep"),
      brandSolid: lire("--brand-solid"),
      onBrand: lire("--on-brand"),
      dangerInk: lire("--danger-ink"),
    };
    sonde.remove();
    return couleurs;
  });
}

function rgb(value: string): [number, number, number] | null {
  const found = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(value);
  if (!found) return null;
  return [Number(found[1]), Number(found[2]), Number(found[3])];
}

function luminance(value: string): number | null {
  const channels = rgb(value);
  if (!channels) return null;
  const [r, g, b] = channels.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(fg: string, bg: string): number | null {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PAIRES_CONTRASTE: ReadonlyArray<readonly [keyof Couleurs, keyof Couleurs, number]> = [
  ["ink", "page", 4.5],
  ["ink", "surface", 4.5],
  ["brandDeep", "surface", 4.5],
  ["onBrand", "brandSolid", 4.5],
  ["dangerInk", "surface", 4.5],
];

async function masques(page: Page): Promise<Locator[]> {
  const out: Locator[] = [];
  for (const selector of MASQUES) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) out.push(locator);
  }
  return out;
}

for (const [name, route] of SMOKE_ROUTES) {
  test(`${name} (${route}) — axe, contraste et capture`, async ({ page }) => {
    await ouvrir(page, route, false);

    const clair = await scannerAxe(page);
    expect(clair, formaterViolations(route, "clair", clair)).toEqual([]);

    const couleurs = await couleursAppliquees(page);
    for (const [fg, bg, minimum] of PAIRES_CONTRASTE) {
      const ratio = contraste(couleurs[fg], couleurs[bg]);
      expect(ratio, `contraste ${route} clair ${fg}/${bg} : ${ratio}`).not.toBeNull();
      expect(ratio ?? 0, `contraste ${route} clair ${fg}/${bg} : ${ratio}`).toBeGreaterThanOrEqual(minimum);
    }

    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: false,
      mask: await masques(page),
    });

    await ouvrir(page, route, true);
    const sombre = await scannerAxe(page);
    expect(sombre, formaterViolations(route, "sombre", sombre)).toEqual([]);
  });
}

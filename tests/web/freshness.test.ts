// Un état de cache ment s'il ne dit pas quand la donnée a été lue, ou s'il
// annonce « hors-ligne » alors que l'appareil est en ligne. Ces tests lisent
// ce que l'élève voit et la cause stable qui la produit, avec une horloge fixe.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { failureCause, freshnessLabel } from "../../web/src/lib/freshness";
import { StaleBadge } from "../../web/src/ui/components";

const ROOT = join(import.meta.dir, "..", "..");
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

function render(props: Parameters<typeof StaleBadge>[0]): string {
  return renderToStaticMarkup(createElement(StaleBadge, { now: NOW, ...props }));
}

describe("fraîcheur : la cause et l'âge, jamais une affirmation gratuite", () => {
  test("hors-ligne, réseau et autre cause ont chacun leur libellé", () => {
    const fetchedAt = NOW - 2 * 3_600_000;
    expect(render({ fetchedAt, cause: "offline" })).toContain(
      "hors-ligne · mis à jour il y a 2 h",
    );
    expect(render({ fetchedAt, cause: "network" })).toContain(
      "réseau indisponible · mis à jour il y a 2 h",
    );
    expect(render({ fetchedAt, cause: "other" })).toContain(
      "erreur de lecture · mis à jour il y a 2 h",
    );
  });

  test("un cache simplement périmé ne se dit pas hors-ligne", () => {
    const html = render({ fetchedAt: NOW - 10 * 60_000 });
    expect(html).toContain("mis à jour il y a 10 min");
    expect(html).not.toContain("hors-ligne");
  });

  test("sans date, le repli reste une phrase honnête", () => {
    expect(render({ cause: "offline" })).toContain(">hors-ligne<");
    expect(render({ label: "analyse en cache" })).toContain(">analyse en cache<");
    expect(render({ fetchedAt: 0 })).toContain(">fraîcheur inconnue<");
    expect(render({ fetchedAt: Number.NaN })).toContain(">fraîcheur inconnue<");
  });

  test("l'horloge avance : la même entrée vieillit sans rechargement", () => {
    const fetchedAt = Date.UTC(2026, 10, 3, 10, 0, 0);
    expect(freshnessLabel({ fetchedAt, now: NOW })).toBe("mis à jour il y a 2 h");
    expect(freshnessLabel({ fetchedAt, now: NOW + 3_600_000 })).toBe(
      "mis à jour il y a 3 h",
    );
  });

  test("la cause native est respectée, sauf si l'appareil est hors-ligne", () => {
    expect(failureCause(null, true)).toBeNull();
    expect(failureCause("échec", false)).toBe("offline");
    expect(failureCause("échec", true)).toBe("network");
    expect(failureCause("refus", true, "other")).toBe("other");
    expect(failureCause("échec", true, "offline")).toBe("offline");
    expect(failureCause("échec", false, "network")).toBe("offline");
  });

  test("le réessai recharge la même vue sans masquer le cache", () => {
    const html = render({ fetchedAt: NOW - 60_000, onRetry: () => {} });
    expect(html).toContain(">Actualiser<");
    expect(html).toContain("mis à jour il y a 1 min");
  });
});

describe("écrans : cause, date et réessai sont réellement branchés", () => {
  const screens = [
    "features/grades/components.tsx",
    "features/tasks/TasksScreen.tsx",
    "routes/news.tsx",
    "routes/canteen.tsx",
    "features/attendance/SchoolLifeScreens.tsx",
    "features/home/HomeScreen.tsx",
    "features/timetable/TimetableScreen.tsx",
    "features/messages/MessagesScreen.tsx",
    "routes/alerts.tsx",
  ];
  for (const screen of screens) {
    test(`${screen} passe la cause et un réessai`, () => {
      const source = readFileSync(join(ROOT, "web", "src", screen), "utf8");
      expect(source).toMatch(/<StaleBadge[\s\S]{0,220}cause=/);
      expect(source).toMatch(/<StaleBadge[\s\S]{0,300}onRetry=/);
    });
  }

  test("la cantine lit une horloge qui tique, pas l'heure du rendu", () => {
    const source = readFileSync(join(ROOT, "web", "src", "routes", "canteen.tsx"), "utf8");
    expect(source).toContain("const now = useNow()");
    expect(source).not.toContain("const now = Date.now()");
  });
});

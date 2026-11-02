// Un état hors-ligne ment s'il ne dit pas quand la donnée a été lue. Le badge
// est rendu : ce test lit ce que l'élève voit, pas la source.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaleBadge } from "../../web/src/ui/components";

const ROOT = join(import.meta.dir, "..", "..");

function render(fetchedAt?: number): string {
  return renderToStaticMarkup(createElement(StaleBadge, { fetchedAt }));
}

describe("StaleBadge : la fraîcheur est dans la phrase (#804)", () => {
  test("une date connue donne « hors-ligne · mis à jour … »", () => {
    const html = render(Date.now() - 2 * 3_600_000);
    expect(html).toContain("hors-ligne · mis à jour il y a 2 h");
  });

  test("sans date, le repli reste une phrase honnête", () => {
    expect(render()).toContain(">hors-ligne<");
    expect(render(0)).toContain(">hors-ligne<");
    expect(render(Number.NaN)).toContain(">hors-ligne<");
  });

  test("les écrans hors-ligne passent leur date au badge", () => {
    const screens = [
      "features/grades/components.tsx",
      "features/tasks/TasksScreen.tsx",
      "routes/news.tsx",
      "routes/canteen.tsx",
      "features/attendance/SchoolLifeScreens.tsx",
      "features/home/HomeScreen.tsx",
      "features/timetable/TimetableScreen.tsx",
    ];
    for (const screen of screens) {
      const source = readFileSync(join(ROOT, "web", "src", screen), "utf8");
      expect(source).toMatch(/<StaleBadge[\s\S]{0,80}fetchedAt=/);
    }
  });
});

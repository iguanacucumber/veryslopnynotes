import { expect, test } from "bun:test";
import { ask, canonTs, portError, skip } from "../fixtures/pronote-client";

export function registerClientResolver(): void {
  test.skipIf(skip)("resolveur : dates FR, 6 + 3 branches, refus identiques", async () => {
    const dates: Array<[string, string]> = [
      ["dateParse", "12/09/2026"],
      ["dateParse", "12/09/26"],
      ["dateParse", "12/09/2026 08:00:00"],
      ["dateParse", "12/09/26 08h00"],
      ["datetimeParse", "12/09/2026"],
      ["datetimeParse", "12/09/2026 08:00:00"],
      ["datetimeParse", "12/09/26 08h00"],
    ];
    const { Util } = await import("../../../node_modules/pronotets/dist/resolver.js");
    for (const [kind, text] of dates) {
      const kt = JSON.parse(await ask({ op: kind, text })) as { millis: number };
      const ts = (Util[kind as "dateParse"] as (s: string) => Date)(text).getTime();
      expect(`${kind} ${text} -> ${kt.millis}`).toBe(`${kind} ${text} -> ${ts}`);
    }
    // Débordements : cascade calendaire comme `new Date` (jamais d'erreur).
    for (const [kind, text] of [["dateParse", "32/09/2026"], ["dateParse", "12/13/2026"], ["dateParse", "12/09/2026 25:00:00"]] as Array<[string, string]>) {
      const kt = JSON.parse(await ask({ op: kind, text })) as { millis: number };
      const ts = (Util[kind as "dateParse"] as (s: string) => Date)(text).getTime();
      expect(`${kind} ${text} -> ${kt.millis}`).toBe(`${kind} ${text} -> ${ts}`);
    }
    // Refus : JJ/MM et HHMM en datetimeParse, formats absurdes partout.
    const bad: Array<[string, string]> = [
      ["datetimeParse", "12/09"],
      ["datetimeParse", "0800"],
      ["dateParse", "2026-09-12"],
      ["dateParse", "8/9/2026"],
    ];
    for (const [kind, text] of bad) {
      const kt = portError(await ask({ op: kind, text }, true));
      let tsName = "";
      try {
        (Util[kind as "dateParse"] as (s: string) => Date)(text);
      } catch (e) {
        tsName = (e as Error).name;
      }
      // `JJ/MM` en dateParse dépend de l'année courante : les deux acceptent.
      expect(`${kind} ${text} -> ${kt.name}`).toBe(`${kind} ${text} -> DateParsingError`);
      expect(tsName).toBe("DateParsingError");
    }
  });

  test.skipIf(skip)("resolveur : notes codées, HTML, tranches, nombres", async () => {
    const { Util } = await import("../../../node_modules/pronotets/dist/resolver.js");
    for (const text of ["14,50", "12.5", "|1", "|8", "|9", "|", "note"]) {
      const kt = JSON.parse(await ask({ op: "gradeParse", text }));
      expect(`gradeParse ${text} -> ${canonTs(kt)}`).toBe(`gradeParse ${text} -> ${canonTs({ value: Util.gradeParse(text) ?? null })}`);
    }
    for (const text of ["<p>Bonjour&nbsp;&amp;</p>", "a&#x41;b&#66;c&douteux;", ""]) {
      expect(await ask({ op: "htmlParse", text })).toBe(JSON.stringify({ value: Util.htmlParse(text) }));
    }
    const heures = [{ G: 1, L: "08h00" }, { G: 2, L: "09h00" }, { G: 3, L: "10h00" }];
    for (const place of [1, 3, 5]) {
      const kt = await ask({ op: "place2time", heures, place });
      const ts = Util.place2time(heures as never, place);
      expect(`place ${place} -> ${kt}`).toBe(`place ${place} -> ${canonTs(ts)}`);
    }
    // Tranche illisible : les deux jettent (classes brutes différentes, fait assumé).
    for (const bad of [[{ G: 1, L: "8h00" }], null]) {
      const kt = portError(await ask({ op: "place2time", heures: bad, place: 1 }, true));
      expect(kt.name).toBe("IllegalStateException");
      let threw = false;
      try {
        Util.place2time(bad as never, 1);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }
    for (const value of ["", " 12 ", "0x10", "0b101", "0o17", "Infinity", "-Infinity", "abc", "12abc", 12.5, true, null]) {
      const kt = JSON.parse(await ask({ op: "numOf", value })) as { value: number | null };
      const ts = (await import("../../../node_modules/pronotets/dist/resolver.js") as unknown as { num: (v: unknown) => number }).num(value);
      expect(`num ${JSON.stringify(value)} -> ${canonTs(kt)}`).toBe(`num ${JSON.stringify(value)} -> ${canonTs({ value: ts })}`);
    }
    for (const value of ["", "x", 0, 1, null, false, true]) {
      const kt = JSON.parse(await ask({ op: "boolOf", value })) as { value: boolean };
      const { bool } = await import("../../../node_modules/pronotets/dist/resolver.js");
      expect(`bool ${JSON.stringify(value)} -> ${canonTs(kt)}`).toBe(`bool ${JSON.stringify(value)} -> ${canonTs({ value: bool(value) })}`);
    }
  });

  // #417 : `Number()` d'un TABLEAU = `Number(join)` côté JS. Le port rendait
  // `NaN` pour TOUT tableau : `"nbNonLus": []` → 0, `"duree": [30]` → 30.

  test.skipIf(skip)("nombres : `Number()` des TABLEAUX comme en JS ([] = 0, [30] = 30, [1,2] = NaN)", async () => {
    const { num } = await import("../../../node_modules/pronotets/dist/resolver.js");
    const cases: unknown[] = [[], [30], [null], [1, 2], [true], [[]], [[1], [2]], [{}], [" "], ["1"], ["1,2"]];
    for (const value of cases) {
      const kt = JSON.parse(await ask({ op: "numOf", value })) as { value: number | null };
      expect(`num ${JSON.stringify(value)} -> ${canonTs(kt)}`).toBe(`num ${JSON.stringify(value)} -> ${canonTs({ value: num(value) })}`);
    }
  });

  // #417 : `String()` d'un TABLEAU = son `join(",")` : `null` → chaîne VIDE.
  // Le port rendait le texte littéral `null` (un motif d'absence affiché).

  test.skipIf(skip)("chaînes : `String()` des TABLEAUX comme en JS ([null] = \"\", [1,2] = \"1,2\")", async () => {
    const { str } = await import("../../../node_modules/pronotets/dist/resolver.js");
    const cases: unknown[] = [[], [null], [1, 2], [[1], [2]], [{}], [[null]], ["a", null, "b"], [true], [0], [""]];
    for (const value of cases) {
      const kt = JSON.parse(await ask({ op: "strOf", value })) as { value: string };
      expect(`str ${JSON.stringify(value)} -> ${canonTs(kt)}`).toBe(`str ${JSON.stringify(value)} -> ${canonTs({ value: str(value) })}`);
    }
  });

  // #417 : `new Date(y, …)` REMAPPE les années 0..99 en 1900+y (`new Date(26, 8, 5)`
  // = 1926). Le port gardait l'année 26 : une date qui n'existe pas.

  test.skipIf(skip)("dates : `new Date()` remappe les années 0..99 (05/09/0026 → 1926)", async () => {
    const { Util } = await import("../../../node_modules/pronotets/dist/resolver.js");
    for (const text of ["05/09/0026", "05/09/0099", "05/09/0026 08:00:00", "12/09/26"]) {
      const kt = JSON.parse(await ask({ op: "dateParse", text })) as { millis: number };
      const ts = (Util.dateParse as (s: string) => Date)(text).getTime();
      expect(`dateParse ${text} -> ${kt.millis}`).toBe(`dateParse ${text} -> ${ts}`);
    }
  });
}

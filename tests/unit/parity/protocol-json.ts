import { expect, test } from "bun:test";
import { ask, portError, skip, tsErrorOf } from "../fixtures/pronote-protocol";

export function registerProtocolJson(): void {
  test.skipIf(skip)("pilote : Json embarqué contre JSON.parse/stringify, charges méchantes", async () => {
    const nasty = [
      '{"a":"éè\\u00e9\\n\\t\\"\\\\\\/\\b\\f\\r","b":[1,-0,1e21,1.5e-7,0.0001,1e300,-0.0],"c":{"imbriqué":{"liste":[true,false,null,{}]}}}',
      '{"dup":1,"dup":2}',
      '{"surogats":"\\ud83d\\ude00\\ud800seul","vide":"","grand":123456789012345680}',
      '{}',
      '[]',
      '{"x":[[]]}',
    ];
    for (const text of nasty) {
      const kt = await ask({ op: "jsonEcho", text });
      expect(`${text} -> ${kt}`).toBe(`${text} -> ${JSON.stringify(JSON.parse(text))}`);
    }
    // Invalides : les deux refusent (la position n'est pas contractuelle).
    for (const text of ['{"a":01}', "{'a':1}", '{"a":undefined}', '{"ouvert":']) {
      const ktErr = portError(await ask({ op: "jsonEcho", text }, true));
      const tsErr = tsErrorOf(() => JSON.parse(text));
      expect(ktErr.name).toBe("JsonError");
      expect(tsErr?.name).toBe("SyntaxError");
    }
  });

  // `\u` STRICT : 4 hex exactement ; `toIntOrNull(16)` acceptait un signe.

  test.skipIf(skip)("json : échappement `\\u` strict (4 hex, pas de signe)", async () => {
    const invalides = ['"\\u+041"', '"\\u-041"', '"\\u 41"', '"\\u00g1"', '"\\ud83d\\u+123"'];
    for (const text of invalides) {
      const ktErr = portError(await ask({ op: "jsonEcho", text }, true));
      const tsErr = tsErrorOf(() => JSON.parse(text));
      expect(`${text} -> ${ktErr.name}`).toBe(`${text} -> JsonError`);
      expect(`${text} -> ${tsErr?.name}`).toBe(`${text} -> SyntaxError`);
    }
    // Les échappements valides restent acceptés (paire de surrogates comprise).
    for (const text of ['"\\u0041"', '"\\u00e9"', '"\\ud83d\\ude00"', '"\\ud83d"']) {
      const kt = await ask({ op: "jsonEcho", text });
      expect(`${text} -> ${kt}`).toBe(`${text} -> ${JSON.stringify(JSON.parse(text))}`);
    }
  });

  // Hex STRICT : `Character.digit` acceptait les chiffres Unicode (`０１`, `٠١`).

  test.skipIf(skip)("octets : hex strict (les chiffres Unicode non ASCII sont refusés)", async () => {
    for (const hex of ["", "00", "ff", "00112233445566778899aabbccddeeff", "DEADBEEF"]) {
      const kt = await ask({ op: "hexToBytes", hex });
      expect(`${hex} -> ${kt}`).toBe(`${hex} -> ${JSON.stringify({ hex: Buffer.from(hex, "hex").toString("hex") })}`);
    }
    // Chiffres pleine largeur et arabo-indiens : pas des hexadécimaux ASCII.
    for (const hex of ["０１", "٠١", "0z", "zz", "0", "0x"]) {
      const ktErr = portError(await ask({ op: "hexToBytes", hex }, true));
      expect(`${hex} -> ${ktErr.name}`).toBe(`${hex} -> IllegalArgumentException`);
      // La référence refuse aussi : aucun n'invente l'octet.
      expect(Buffer.from(hex, "hex").toString("hex")).not.toBe("01");
    }
  });

  // `ExpiredObject` hérite de `PronoteAPIError` : le `catch` documenté l'attrape.

  test.skipIf(skip)("erreurs : `ExpiredObject` est un `PronoteAPIError` (contrat du catch)", async () => {
    const { ExpiredObject, PronoteAPIError } = await import("../../../node_modules/pronotets/dist/exceptions.js");
    const tsErr = new ExpiredObject("objet d'une session précédente");
    expect(tsErr.name).toBe("ExpiredObject");
    expect(tsErr instanceof PronoteAPIError).toBe(true);
    const kt = JSON.parse(await ask({ op: "errorHierarchy" })) as { name: string; caughtAs: string };
    expect(kt.name).toBe("ExpiredObject");
    expect(kt.caughtAs).toBe("ExpiredObject");
  });

  test.skipIf(skip)("nombres : le rendu Kotlin est IDENTIQUE à `JSON.stringify` (#410)", async () => {
    // Texte brut, pas un nombre JSON : `JSON.stringify(-0)` vaut `"0"`. Chaque
    // case est lue des deux côtés, donc même double et même rendu attendu.
    const cases = [
      "0", "-0", "20", "0.5", "0.1", "0.30000000000000004",
      "1e-4", "1e-6", "1e-7", "1.5e-7", "1e21", "1e19", "1e20", "-1e19",
      // Les grands entiers : `toLong()` saturait (1e19 → 9223372036854775807).
      "1.2345678901234568E18", "9007199254740992", "9007199254740993",
      "123456789012345680", "9223372036854775808", "5e19", "1.7976931348623157E308",
      "5e-324", "1e-321",
      // À mi-chemin des deux décimales (JS prend le chiffre PAIR) et 17
      // chiffres significatifs : le rendu ne doit pas dépendre de la JVM.
      "106366337364200.625", "1.0000000000000002",
    ];
    for (const raw of cases) {
      const expected = JSON.stringify(Number(raw));
      const kt = (JSON.parse(await ask({ op: "jsNumber", value: raw })) as { text: string }).text;
      expect(`pronote ${raw} -> ${kt}`).toBe(`pronote ${raw} -> ${expected}`);
    }
  });
}

// Parité TS <-> Kotlin sur le corpus RÉEL (#202).
//
// Le corpus local (`tests/fixtures/pronote/`, gitignoré) porte des formes que
// les fixtures scriptées n'ont pas : libellés d'établissement, unicode,
// tableaux imbriqués. Ce test fait passer les MÊMES octets des deux côtés —
// canonique TS (`agents/runtime/replay-corpus.ts`) contre `Json` du port
// (`agents/runtime/kotlin-parity/CorpusParityMain.kt`) — et compare à
// l'octet près. Une divergence casse au domaine + champ près.
//
// Limite assumée : le corpus stocke la SORTIE des anciens readers TS, pas le fil
// brut — ce test prouve la fidélité JSON sur données réelles, pas les mappers
// (couverts par les cas scriptés des deux autres fichiers de parité).
//
// Sans corpus OU sans `kotlinc`/`java` : SKIP BRUYANT, `make check` vert
// sans avoir prouvé de parité (jamais un faux vert). Le harnais lui-même
// (canonique, déterminisme, refus) est testé sur fixtures synthétiques et
// tourne TOUJOURS.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compactCanon,
  replayCorpus,
  replayDomain,
  replayDomains,
} from "../../agents/runtime/replay-corpus";
import { CORPUS_DIR, CORPUS_DOMAINS, hasCorpus } from "./fixtures/pronote-corpus";
import { ROOT, canonTs, parityToolchain, type ParityLink } from "./fixtures/kotlin-harness";

const HAS_CORPUS = hasCorpus(CORPUS_DIR);
const TOOLCHAIN_SKIP = parityToolchain.skipReason !== null;
const SKIP = !HAS_CORPUS || TOOLCHAIN_SKIP;

if (!HAS_CORPUS) {
  console.warn(
    "\n" +
      "  SKIP BRUYANT — corpus Pronote local absent.\n" +
      "  La parité TS <-> Kotlin sur données réelles (#202) n'est PAS vérifiée sur cette machine.\n" +
      "  Le corpus gitignoré doit être présent localement pour rejouer ce contrôle.\n",
  );
} else if (TOOLCHAIN_SKIP) {
  console.warn(
    "\n" +
      "  SKIP BRUYANT — parité corpus non vérifiée : " +
      (parityToolchain.skipReason ?? "outillage absent") +
      "\n",
  );
}

let link: ParityLink | null = null;
if (!SKIP) {
  link = await parityToolchain.openParityLink(
    join(ROOT, "agents", "runtime", "kotlin-parity", "CorpusParityMain.kt"),
  );
}

async function ask(op: unknown, allowError = false): Promise<string> {
  return link!.ask(op, { allowError });
}

/** Premier chemin où deux structures diffèrent (`$.items[3].value`), `null` si égales. */
export function firstDiffPath(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return path;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiffPath(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const recA = a as Record<string, unknown>;
    const recB = b as Record<string, unknown>;
    for (const k of Object.keys(recA).sort()) {
      if (!(k in recB)) return `${path}.${k} (absent côté Kotlin)`;
    }
    for (const k of Object.keys(recB).sort()) {
      if (!(k in recA)) return `${path}.${k} (absent côté TS)`;
    }
    for (const k of Object.keys(recA).sort()) {
      const d = firstDiffPath(recA[k], recB[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return path;
}

function tempCorpus(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "corpus-replay-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.json`), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

describe("harnais de replay corpus (#202)", () => {
  test("compactCanon = canonTs du harnais (clés triées, undefined omis, tableaux intacts)", () => {
    const samples: unknown[] = [
      { b: 1, a: { d: 2, c: undefined } },
      [3, 1, 2],
      { accent: "Éléonore — 妥当性 😀", nested: [{ z: null, a: [1e21, 0.0001, -0] }] },
      {},
      { dup: 1 },
    ];
    for (const s of samples) {
      expect(compactCanon(s)).toBe(canonTs(s));
    }
  });

  test("replay déterministe : même corpus, mêmes octets", () => {
    const fixture = {
      __untrusted: true,
      items: [{ id: "g-1", value: 15, subject: "Maths", note: "àccentué" }],
      nextCursor: null,
    };
    const a = tempCorpus({ grades: fixture, menus: { __untrusted: true, error: "pronote_unavailable" } });
    // Ordre d'insertion volontairement différent : la canonisation vient du replay.
    const b = tempCorpus({ menus: { error: "pronote_unavailable", __untrusted: true }, grades: fixture });
    expect(replayDomains(a)).toEqual(["grades", "menus"]);
    expect(replayCorpus(a)).toEqual(replayCorpus(b));
    expect(`${JSON.stringify(replayCorpus(a))}`).toBe(`${JSON.stringify(replayCorpus(b))}`);
  });

  test("corpus rejouable seulement si chaque fixture est marquée", () => {
    expect(hasCorpus(tempCorpus({ grades: { __untrusted: true, items: [] } }))).toBe(true);
    expect(hasCorpus(tempCorpus({ grades: { items: [] } }))).toBe(false);
    expect(hasCorpus(mkdtempSync(join(tmpdir(), "corpus-vide-")))).toBe(false);
  });

  test("refus nets : répertoire absent, corpus vide, fixture non marquée", () => {
    expect(() => replayCorpus(join(tmpdir(), "corpus-absent-xyz"))).toThrow("corpus local absent");
    const empty = mkdtempSync(join(tmpdir(), "corpus-vide-"));
    expect(() => replayCorpus(empty)).toThrow("corpus local absent");
    const bad = tempCorpus({ grades: { items: [] } });
    expect(() => replayDomain("grades", bad)).toThrow("__untrusted");
    expect(() => replayDomain("manquant", tempCorpus({ grades: { __untrusted: true } }))).toThrow("absent du corpus");
  });

  test("firstDiffPath localise le champ divergent", () => {
    expect(firstDiffPath({ a: 1 }, { a: 1 })).toBeNull();
    expect(firstDiffPath({ a: 1 }, { a: 2 })).toBe("$.a");
    expect(firstDiffPath({ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 1 }, { v: 3 }] })).toBe("$.items[1].v");
    expect(firstDiffPath({ a: 1 }, {})).toBe("$.a (absent côté Kotlin)");
    expect(firstDiffPath({}, { b: 1 })).toBe("$.b (absent côté TS)");
    expect(firstDiffPath([1, 2], [1])).toBe("$.length");
  });
});

describe("parité TS <-> Kotlin sur corpus réel (#202)", () => {
  test.skipIf(!HAS_CORPUS)("corpus local contient tous les domaines attendus", () => {
    expect(replayDomains(CORPUS_DIR)).toEqual([...CORPUS_DOMAINS].sort());
  });

  test.skipIf(SKIP)("chaque domaine : octet-identique, divergence = domaine + champ", async () => {
    for (const domain of replayDomains(CORPUS_DIR)) {
      const ts = replayDomain(domain, CORPUS_DIR);
      const raw = readFileSync(join(CORPUS_DIR, `${domain}.json`), "utf8");
      const line = await ask({ op: "corpusCanon", text: raw });
      const kt = canonTs((JSON.parse(line) as { canon: unknown }).canon);
      if (kt !== ts) {
        const champ = firstDiffPath(JSON.parse(ts), JSON.parse(kt)) ?? "?";
        throw new Error(`parité corpus ${domain} : divergence au champ ${champ}`);
      }
      expect(`${domain} -> ${kt}`).toBe(`${domain} -> ${ts}`);
    }
  });
});

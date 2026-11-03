// Stockage plein et horloge en avance : l'échec d'écriture REMONTE, et une
// écriture ratée ne détruit jamais l'entrée précédente. Les timestamps futurs
// sont PÉRIMÉS (jamais frais pour toujours) et la fenêtre EDT reste en heure de
// Paris, y compris les semaines qui traversent un changement d'heure.
// Le VRAI Kotlin compilé est piloté ici, avec des pannes injectées.
// Outillage absent = SKIP BRUYANT ; échec de compilation = défaut.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CacheStorageClockParityMain.kt");
const CACHE = join(DATA, "OfflineCache.kt");
const ARTIFACTS = join(DATA, "OfflineArtifacts.kt");
const REPO = join(DATA, "SyncedRepository.kt");
const DISCUSSIONS = join(DATA, "DiscussionListCache.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown, opts?: { allowError?: boolean }): Promise<any> {
  return JSON.parse(await link!.ask(op, opts));
}

async function newStore(): Promise<number> {
  return (await ask({ op: "newStore" })).sid as number;
}

async function save(
  sid: number,
  resource: string,
  payload: string,
  fetchedAt: number,
  query = "",
  opts?: { allowError?: boolean },
): Promise<any> {
  return ask({ op: "save", sid, resource, payload, fetchedAt, query }, opts);
}

async function load(sid: number, resource: string, query = ""): Promise<any> {
  return ask({ op: "load", sid, resource, query });
}

const NOW = 1_700_000_000_000;
const TMP = /(\.tmp|\.bak)$/;

describe("stockage plein : l'échec remonte et l'ancien cache survit (#915)", () => {
  test.skipIf(skip)("une IOException du writer lève, la réponse précédente reste servie", async () => {
    const sid = await newStore();
    await save(sid, "grades", "ancienne", NOW, "q");

    await ask({ op: "setMode", sid, mode: "fail" });
    const failed = await save(sid, "grades", "neuve", NOW + 1, "q", { allowError: true });
    expect(failed.error).toBe("IOException");

    // L'entrée d'AVANT est intacte, à son horodatage d'origine : pas de
    // fichier tronqué ni de nouvelle entrée partielle servie.
    const found = await load(sid, "grades", "q");
    expect(found.found).toBe(true);
    expect(found.payload).toBe("ancienne");
    expect(found.fetchedAt).toBe(NOW);
    expect((await ask({ op: "files", sid })).files.filter((f: string) => TMP.test(f))).toEqual([]);
  });

  test.skipIf(skip)("une écriture PARTIELLE ne remplace pas l'entrée existante", async () => {
    const sid = await newStore();
    await save(sid, "grades", "ancienne", NOW, "q");

    await ask({ op: "setMode", sid, mode: "partial" });
    const failed = await save(sid, "grades", "neuve-et-plus-longue", NOW + 1, "q", {
      allowError: true,
    });
    expect(failed.error).toBe("IOException");

    const found = await load(sid, "grades", "q");
    expect(found.payload).toBe("ancienne");
    // Aucun demi-payload n'est lisible, même via la lecture brute.
    expect((await ask({ op: "payloads", sid, resource: "grades" })).payloads).toEqual(["ancienne"]);
    expect((await ask({ op: "files", sid })).files.filter((f: string) => TMP.test(f))).toEqual([]);
  });

  test.skipIf(skip)("un échec sur une NOUVELLE requête laisse le cache ABSENT (jamais partiel)", async () => {
    const sid = await newStore();
    await ask({ op: "setMode", sid, mode: "partial" });
    const failed = await save(sid, "timetable", "semaine", NOW, "weekStart=2026-10-19", {
      allowError: true,
    });
    expect(failed.error).toBe("IOException");

    expect((await load(sid, "timetable", "weekStart=2026-10-19")).found).toBe(false);
    expect((await ask({ op: "payloads", sid, resource: "timetable" })).payloads).toEqual([]);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("artefact hors cache : l'échec LÈVE et l'ancien fichier reste lisible", async () => {
    const sid = await newStore();
    const write = (mode: string, content: string, name = "subject_prefs.json") =>
      ask({ op: "artifactWrite", sid, name, content, mode }, { allowError: true });

    expect((await write("ok", "anciennes preferences")).written).toBe(true);
    expect((await ask({ op: "artifactRead", sid })).content).toBe("anciennes preferences");

    for (const mode of ["fail", "partial"]) {
      const failed = await write(mode, "nouvelles preferences");
      expect(failed.error).toBe("IOException");
      expect((await ask({ op: "artifactRead", sid })).content).toBe("anciennes preferences");
    }

    // Un nouveau fichier n'existe pas après un échec.
    expect((await write("partial", "nouveau", "teacher_chat.json")).error).toBe("IOException");
    expect((await ask({ op: "artifactRead", sid, name: "teacher_chat.json" })).exists).toBe(false);
    expect((await ask({ op: "files", sid })).files.filter((f: string) => TMP.test(f))).toEqual([]);
  });

  test("câblage : une écriture ratée est DITE, plus jamais « cache illisible »", () => {
    const repo = readFileSync(REPO, "utf8");
    expect(repo).toContain("Stockage plein ou indisponible");
    expect(repo).not.toContain("Cache illisible.");
    // Le cache et les artefacts partagent la MÊME écriture atomique.
    expect(readFileSync(CACHE, "utf8")).toContain("writeFileAtomically(");
    expect(readFileSync(ARTIFACTS, "utf8")).toContain("writeFileAtomically(");
    // L'ancien remplacement ne supprime plus la cible avant de renommer.
    expect(readFileSync(CACHE, "utf8")).not.toContain("target.delete()");
  });
});

describe("horloge en avance : jamais frais pour toujours (#915)", () => {
  test.skipIf(skip)("un fetchedAt futur est PÉRIMÉ, absent des payloads frais et relu", async () => {
    const sid = await newStore();
    await save(sid, "grades", "futur", NOW + 3_600_000, "q");

    expect((await ask({ op: "stale", resource: "grades", fetchedAt: NOW + 3_600_000, now: NOW })).stale).toBe(true);
    expect((await ask({ op: "freshPayloads", sid, resource: "grades", now: NOW })).payloads).toEqual([]);
    expect(
      (await ask({ op: "shouldFetch", sid, resource: "grades", query: "q", now: NOW })).fetch,
    ).toBe(true);
  });

  test.skipIf(skip)("le cache mémoire à TTL propre expire aussi sur un timestamp futur", async () => {
    expect((await ask({ op: "isExpired", ttl: 60_000, at: NOW + 1, now: NOW })).expired).toBe(true);
    expect((await ask({ op: "isExpired", ttl: 60_000, at: NOW - 1_000, now: NOW })).expired).toBe(false);
    // Le cache des fils de messagerie suit cette règle (plus de soustraction nue).
    const cache = readFileSync(DISCUSSIONS, "utf8");
    expect(cache).toContain("CachePolicy.isExpired(");
    expect(cache).not.toContain("now - at > TTL_MS");
  });

  test.skipIf(skip)("TTL et purge de compte restent inchangés après un échec d'écriture", async () => {
    const sid = await newStore();
    const ttl = 60 * 60 * 1000; // news
    await save(sid, "news", "neuve", NOW, "q");
    expect((await ask({ op: "freshPayloads", sid, resource: "news", now: NOW + ttl / 2 })).payloads).toEqual([
      "neuve",
    ]);
    expect((await ask({ op: "freshPayloads", sid, resource: "news", now: NOW + ttl + 1 })).payloads).toEqual([]);

    // Une écriture ratée ne bloque pas la purge : le compte suivant est propre.
    await ask({ op: "setMode", sid, mode: "fail" });
    await save(sid, "news", "perdue", NOW, "q2", { allowError: true });
    const purged = await ask({ op: "purge", sid });
    expect(purged.cleared).toBe(true);
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });
});

describe("DST / minuit de Paris (#915)", () => {
  const week = async (weekStart: string) => {
    const w = await ask({ op: "window", weekStart });
    return { from: w.from as number, to: w.to as number };
  };

  test.skipIf(skip)("printemps : lundi 00:00 Paris, semaine de 167 h", async () => {
    const w = await week("2026-03-23");
    // 23 mars 2026 00:00 CET = 22 mars 23:00Z (l'heure d'été commence le 29).
    expect(new Date(w.from).toISOString()).toBe("2026-03-22T23:00:00.000Z");
    expect(new Date(w.to).toISOString()).toBe("2026-03-29T21:59:59.999Z");
    expect(w.to + 1 - w.from).toBe(167 * 3_600_000);
  });

  test.skipIf(skip)("automne : la semaine dure 169 h et le lundi suivant est à minuit CET", async () => {
    const w = await week("2026-10-19");
    expect(new Date(w.from).toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(new Date(w.to).toISOString()).toBe("2026-10-25T22:59:59.999Z");
    expect(w.to + 1 - w.from).toBe(169 * 3_600_000);
    // Après le changement d'heure : lundi 26 octobre 00:00 CET = 25 23:00Z.
    const next = await week("2026-10-26");
    expect(new Date(next.from).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

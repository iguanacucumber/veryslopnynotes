// Sans borne, le cache grossissait jusqu'à la mémoire libre : payloads UTF-8
// entiers, entrées par requête sans plafond par ressource, et lectures IA/UI
// servies même périmées. Le VRAI Kotlin compilé est piloté ici (mémoire ET
// disque), avec des payloads synthétiques assez gros pour déclencher l'éviction.
// Outillage absent = SKIP BRUYANT ; échec de compilation = défaut.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CacheBoundsParityMain.kt");

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

async function newStore(kind: "memory" | "file"): Promise<number> {
  return (await ask({ op: "newStore", kind })).sid as number;
}

async function save(
  sid: number,
  resource: string,
  payload: string,
  fetchedAt: number,
  query = "",
): Promise<any> {
  return ask({ op: "save", sid, resource, payload, fetchedAt, query });
}

async function load(sid: number, resource: string, query = ""): Promise<any> {
  return ask({ op: "load", sid, resource, query });
}

const STORES = ["memory", "file"] as const;
const NOW = 1_700_000_000_000;

describe("budgets explicites du cache (#902)", () => {
  test.skipIf(skip)("les plafonds sont déclarés, pas implicites", async () => {
    const budgets = await ask({ op: "budgets" });
    expect(budgets.maxPayloadBytes).toBe(512 * 1024);
    expect(budgets.maxTotalBytes).toBe(2 * 1024 * 1024);
    // Une entrée par requête ne veut pas dire illimité : chaque ressource a son cap.
    const caps: number[] = [];
    for (const resource of [
      "grades",
      "assignments",
      "timetable",
      "news",
      "menus",
      "attendance",
      "punishments",
      "capabilities",
      "discussions",
      "security-alerts",
    ]) {
      caps.push((await ask({ op: "maxEntries", resource })).maxEntries);
    }
    expect(caps).toEqual([8, 12, 8, 4, 4, 8, 4, 2, 4, 2]);
  });

  test.skipIf(skip)("un payload au-delà du budget UTF-8 est REFUSÉ avant écriture", async () => {
    const { maxPayloadBytes } = await ask({ op: "budgets" });
    // Deux octets par « é » : la longueur en CARACTÈRES est sous le plafond,
    // seule la mesure UTF-8 le dépasse. Un cache qui compterait `length`
    // accepterait ce payload.
    const payload = "é".repeat(maxPayloadBytes / 2 + 1);
    expect(payload.length).toBeLessThan(maxPayloadBytes);
    for (const kind of STORES) {
      const sid = await newStore(kind);
      const refused = await ask(
        { op: "save", sid, resource: "grades", payload, fetchedAt: NOW, query: "big" },
        { allowError: true },
      );
      expect(refused.error).toBe("IllegalArgumentException");
      expect((await load(sid, "grades", "big")).found).toBe(false);
      if (kind === "file") {
        expect((await ask({ op: "files", sid })).files).toEqual([]);
      }
    }
  });
});

describe("éviction LRU par octets (#902)", () => {
  test.skipIf(skip)("le cache total reste sous le budget, l'entrée NON relue part", async () => {
    const { maxPayloadBytes } = await ask({ op: "budgets" });
    // 4 × 500 Kio tiennent sous 2 Mio ; la 5e dépasse. A est relu juste avant,
    // donc B (le plus ancien accès) doit partir, pas A.
    const size = 500 * 1024;
    expect(size).toBeLessThan(maxPayloadBytes);
    for (const kind of STORES) {
      const sid = await newStore(kind);
      for (const tag of ["A", "B", "C", "D"]) {
        await save(sid, "assignments", tag + "x".repeat(size - 1), NOW, `week=${tag}`);
      }
      expect((await load(sid, "assignments", "week=A")).found).toBe(true);
      await save(sid, "assignments", "E" + "x".repeat(size - 1), NOW, "week=E");
      expect((await load(sid, "assignments", "week=A")).found).toBe(true);
      expect((await load(sid, "assignments", "week=B")).found).toBe(false);
      for (const tag of ["C", "D", "E"]) {
        expect((await load(sid, "assignments", `week=${tag}`)).found).toBe(true);
      }
    }
  });
});

describe("plafond d'entrées par ressource (#902)", () => {
  test.skipIf(skip)("une ressource garde au plus son cap, les plus anciens partent", async () => {
    for (const kind of STORES) {
      const sid = await newStore(kind);
      for (const query of ["q0", "q1", "q2"]) {
        await save(sid, "capabilities", `{\"tabs\":[\"${query}\"]}`, NOW, query);
      }
      expect((await load(sid, "capabilities", "q0")).found).toBe(false);
      expect((await load(sid, "capabilities", "q1")).found).toBe(true);
      expect((await load(sid, "capabilities", "q2")).found).toBe(true);
    }
  });
});

describe("TTL filtré pour les lectures IA/UI (#902)", () => {
  test.skipIf(skip)("freshPayloads ne rend que les entrées fraîches", async () => {
    const ttl = 60 * 60 * 1000; // news
    for (const kind of STORES) {
      const sid = await newStore(kind);
      // L'ancienne a la moitié du TTL à l'écriture : elle est encore fraîche
      // quand la neuve arrive, mais périmée une demi-période plus tard.
      await save(sid, "news", "ancienne", NOW - ttl / 2, "old");
      await save(sid, "news", "neuve", NOW, "new");
      // Le brut garde les deux (repli hors ligne, diagnostic)…
      expect((await ask({ op: "payloads", sid, resource: "news" })).payloads.sort()).toEqual([
        "ancienne",
        "neuve",
      ]);
      // …mais l'IA/UI ne reçoit que la fraîche.
      expect(
        (await ask({ op: "freshPayloads", sid, resource: "news", now: NOW + ttl / 2 + 1 })).payloads,
      ).toEqual(["neuve"]);
      // Toutes périmées : corpus vide, jamais une vieille semaine réinjectée.
      expect(
        (await ask({ op: "freshPayloads", sid, resource: "news", now: NOW + ttl + 1 })).payloads,
      ).toEqual([]);
    }
  });

  test.skipIf(skip)("une entrée datée dans le FUTUR n'est pas fraîche", async () => {
    const sid = await newStore("file");
    await save(sid, "grades", "futur", NOW + 1000, "avenir");
    expect((await ask({ op: "freshPayloads", sid, resource: "grades", now: NOW })).payloads).toEqual([]);
  });

  test("le dépôt IA/UI lit les payloads FRAIS, pas le brut", () => {
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    expect(repo).toContain("store.freshPayloads(resource, now)");
    expect(repo).toContain("store.freshPayloads(resource, clock())");
  });
});

describe("gros payload déjà sur disque (#902)", () => {
  test.skipIf(skip)("un fichier au-delà du budget n'est jamais lu ni servi", async () => {
    const { maxPayloadBytes } = await ask({ op: "budgets" });
    const sid = await newStore("file");
    const content = `${NOW}\n` + "x".repeat(maxPayloadBytes + 5000);
    await ask({ op: "writeRaw", sid, name: "cache_news_legacy.txt", content });
    expect((await ask({ op: "payloads", sid, resource: "news" })).payloads).toEqual([]);
    expect((await ask({ op: "freshPayloads", sid, resource: "news", now: NOW })).payloads).toEqual([]);
    expect((await ask({ op: "files", sid })).files).not.toContain("cache_news_legacy.txt");
  });
});

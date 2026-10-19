// #369 : une écriture CONFIRMÉE invalide le cache, et la fenêtre de recherche
// du toggle suit la semaine AFFICHÉE.
//
// Le harnais compile la VRAIE logique de production (`CachePolicy`,
// `OfflineCache`, `WeekWindow` — purs, sans Android ni org.json) et la pilote
// (`agents/runtime/kotlin-parity/CacheInvalidationMain.kt`) : les assertions
// portent sur du code EXÉCUTÉ, pas sur un miroir TS.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT (harnais partagé) ; un
// échec de compilation, lui, est un défaut (le test rougit).
//
// Le câblage (le dépôt invalide APRÈS l'écriture, le pont transmet la
// semaine affichée) est épinglé par lecture des sources : `AssignmentsRepository`
// et `DiscussionsRepository` dépendent d'`org.json` et d'`android.os`, hors de
// portée d'un harnais JVM — même limite que le miroir `android-homework`.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const WEB = join(ROOT, "web", "src");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CacheInvalidationMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

const source = (path: string): string => readFileSync(path, "utf8");

interface CacheView {
  served: boolean;
  stale: boolean;
  shouldFetch: boolean;
}

interface InvalidationResult {
  before: CacheView;
  after: CacheView;
  error: string;
  other: CacheView;
}

interface WindowResult {
  from: string;
  to: string;
  inside: string[];
  outside: string[];
}

describe("invalidation du cache après une écriture (#369)", () => {
  test.skipIf(skip)("toggle réussi : l'entrée « assignments » n'est plus servie comme fraîche", async () => {
    const result = JSON.parse(
      await ask({ op: "write", resource: "assignments", now: 1_700_000_000_000 }),
    ) as InvalidationResult;
    // AVANT l'écriture : entrée fraîche servie telle quelle (pas de relecture).
    expect(result.before).toEqual({ served: true, stale: false, shouldFetch: false });
    // APRÈS l'écriture confirmée : l'entrée part, l'écran RELIT (plus de
    // « done=false » qui décoche la case pendant 15 minutes).
    expect(result.after).toEqual({ served: false, stale: false, shouldFetch: true });
    expect(result.error).toBe("");
  });

  test.skipIf(skip)("écriture de messagerie : l'entrée « discussions » n'est plus servie comme fraîche", async () => {
    const result = JSON.parse(
      await ask({ op: "write", resource: "discussions", now: 1_700_000_000_000 }),
    ) as InvalidationResult;
    expect(result.before).toEqual({ served: true, stale: false, shouldFetch: false });
    // Fil supprimé qui réapparaît, fil créé absent, compteur figé : tous
    // corrigés par la même invalidation.
    expect(result.after).toEqual({ served: false, stale: false, shouldFetch: true });
    expect(result.error).toBe("");
  });

  test.skipIf(skip)("une écriture REFUSÉE ne purge rien (rien n'a été écrit)", async () => {
    const result = JSON.parse(
      await ask({ op: "write", resource: "assignments", fails: 1, now: 1_700_000_000_000 }),
    ) as InvalidationResult;
    expect(result.error).toBe("IllegalStateException");
    // L'entrée reste : le cache continue de servir la dernière écriture vraie.
    expect(result.after).toEqual({ served: true, stale: false, shouldFetch: false });
  });

  test.skipIf(skip)("l'invalidation est ciblée : les autres ressources restent en cache", async () => {
    const result = JSON.parse(
      await ask({
        op: "write",
        resource: "assignments",
        other: "discussions",
        now: 1_700_000_000_000,
      }),
    ) as InvalidationResult;
    expect(result.after).toEqual({ served: false, stale: false, shouldFetch: true });
    // La messagerie n'a pas été écrite : son entrée reste servie.
    expect(result.other).toEqual({ served: true, stale: false, shouldFetch: false });
  });
});

describe("fenêtre de recherche = semaine affichée (#369)", () => {
  test.skipIf(skip)("un devoir hors de now−7j/+21j mais dans la semaine demandée est trouvable", async () => {
    const result = JSON.parse(
      await ask({
        op: "window",
        weekStart: "2026-11-16",
        now: "2026-10-19T12:00:00",
        due: ["2026-11-18T08:00:00", "2026-10-20T08:00:00", "2026-11-25T08:00:00"],
      }),
    ) as WindowResult;
    // Le 18 novembre est hors du repli −7/+21 jours (au 9 novembre) mais
    // dans la semaine demandée : il doit être trouvable.
    expect(result.inside).toEqual(["2026-11-18T08:00:00"]);
    // Hors de la semaine demandée : introuvable (le toggle est refusé, comme
    // avant pour un devoir qui n'existe pas).
    expect(result.outside).toEqual(["2026-10-20T08:00:00", "2026-11-25T08:00:00"]);
  });

  test.skipIf(skip)("sans semaine demandée : repli −7/+21 jours", async () => {
    const result = JSON.parse(
      await ask({
        op: "window",
        weekStart: null,
        now: "2026-10-19T12:00:00",
        due: ["2026-10-15T08:00:00", "2026-11-05T08:00:00", "2026-11-20T08:00:00"],
      }),
    ) as WindowResult;
    expect(result.inside).toEqual(["2026-10-15T08:00:00", "2026-11-05T08:00:00"]);
    expect(result.outside).toEqual(["2026-11-20T08:00:00"]);
  });

  test.skipIf(skip)("une semaine illisible retombe sur le repli (jamais de fenêtre vide)", async () => {
    const illisible = JSON.parse(
      await ask({
        op: "window",
        weekStart: "illisible",
        now: "2026-10-19T12:00:00",
        due: ["2026-10-15T08:00:00", "2026-11-20T08:00:00"],
      }),
    ) as WindowResult;
    const absente = JSON.parse(
      await ask({
        op: "window",
        weekStart: null,
        now: "2026-10-19T12:00:00",
        due: ["2026-10-15T08:00:00", "2026-11-20T08:00:00"],
      }),
    ) as WindowResult;
    expect(illisible).toEqual(absente);
    expect(illisible.inside).toEqual(["2026-10-15T08:00:00"]);
  });
});

describe("câblage de l'invalidation et de la fenêtre (#369)", () => {
  const assignments = source(join(DATA, "AssignmentsRepository.kt"));
  const discussions = source(join(DATA, "DiscussionsRepository.kt"));
  const payloads = source(join(DATA, "PronotePayloads.kt"));
  const bridge = source(join(APP, "VsnBridge.kt"));
  const tasks = source(join(WEB, "features", "tasks", "TasksScreen.tsx"));
  const client = source(join(WEB, "bridge", "client.ts"));

  test("le toggle invalide le cache APRÈS l'écriture confirmée", () => {
    // L'écriture passe par `writeAndInvalidate` : `setDone` (qui lève si
    // l'écriture échoue) DANS le bloc, l'invalidation après.
    expect(assignments).toContain(
      "writeAndInvalidate(cache, CachePolicy.ASSIGNMENTS) { found.setDone(done) }",
    );
    // `setDone` n'est appelé qu'à travers ce bloc (jamais seul : une écriture
    // échouée ne doit rien purger).
    expect(assignments.match(/found\.setDone\(done\)/g)?.length).toBe(1);
    // Le dépôt reçoit le cache : l'invalidation native est possible.
    expect(bridge).toContain("AssignmentsRepository(cacheStore)");
  });

  test("chaque écriture de messagerie invalide le cache des fils", () => {
    // Les 4 écritures (reply/create/setRead/delete) passent par `writeLocal`.
    expect(discussions).toContain("writeAndInvalidate(cache, CachePolicy.DISCUSSIONS) { block() }");
    expect(discussions.match(/writeLocal\(/g)?.length).toBe(5); // 4 écritures + la définition
    expect(bridge).toContain("DiscussionsRepository(cacheStore)");
  });

  test("l'affichage et la recherche partagent la MÊME fenêtre", () => {
    // Le payload affiché et la recherche du toggle/pièce jointe sortent de la
    // même fonction : un devoir affiché reste trouvable.
    expect(payloads).toContain('assignmentWindow(query["weekStart"], now)');
    expect(assignments.match(/assignmentWindow\(weekStart\)/g)?.length).toBe(2);
    // Toggle ET pièce jointe cherchent dans cette fenêtre (pas une autre).
    expect(assignments).toContain("val (from, to) = assignmentWindow(weekStart)");
    expect(assignments.match(/client\.homework\(from, to\)/g)?.length).toBe(2);
  });

  test("le pont transmet la semaine affichée", () => {
    expect(bridge).toContain('p.string("weekStart")');
    expect(bridge).toContain("assignments.toggle(currentBaseUrl(), id, done, week, cb)");
    expect(bridge).toContain("assignments.fetchAttachment(homeworkId, attachmentId, week, cb)");
    // L'aide devoirs lit le cache des devoirs : même fenêtre affichée.
    expect(bridge).toContain("loadAssignments(id, week)");
  });

  test("l'écran envoie la semaine affichée", () => {
    expect(tasks).toContain("bridge.toggleAssignment(assignment.id, next, week)");
    expect(tasks).toContain("bridge.openAttachment(assignment.id, attachment.id, week)");
    // L'aide devoirs lit le même cache : elle suit la semaine affichée aussi.
    expect(tasks).toContain("bridge.askHomework(assignment.id, week)");
    expect(client).toContain('"assignments.toggle", { id, done, weekStart }');
    expect(client).toContain('"assignments.attachment", { homeworkId, attachmentId, weekStart }');
    expect(client).toContain('"llm.askHomework", { assignmentId, weekStart }');
  });

  test("une SEULE invalidation, côté natif (le web n'invalide pas)", () => {
    // `bridge.invalidate` existe mais n'est JAMAIS appelé : l'invalidation suit
    // l'écriture, dans le natif (source de vérité), pas dans l'écran.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (codeOnly(readFileSync(path, "utf8")).includes("bridge.invalidate(")) {
          offenders.push(path.slice(ROOT.length + 1));
        }
      }
    };
    walk(WEB);
    expect(offenders).toEqual([]);
  });
});

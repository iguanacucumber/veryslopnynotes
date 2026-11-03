// La mémoire d'une réponse est BORNÉE : plafond d'octets, mémo bornée par
// octets UTF-8, dernier échange relâché, pièces jointes écrites en flux.
// Le VRAI transport tourne contre un serveur local ; le pilote basse mémoire
// (`-Xmx32m`) prouve qu'un corps de 32 Mio ne passe jamais par un tampon.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const HTTP_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PronoteParityMain.kt");
const MEMO_DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "ReadMemoParityMain.kt");
const COMMUNICATION = join(ROOT, "android/pronote/src/main/java/fr/veryslopnynotes/pronote/Communication.kt");
const ASSIGNMENTS = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data/AssignmentsRepository.kt");
const ATTACHMENTS = join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/Attachments.kt");

const skip = parityToolchain.skipReason !== null;

const SMALL = "bonjour";
const GZ_BODY = "EDT de la semaine 42 — accents, devoirs. ".repeat(40);
const BIG_BYTES = 32 * 1024 * 1024;

let httpLink: ParityLink | null = null;
let memoLink: ParityLink | null = null;
if (!skip) {
  httpLink = await parityToolchain.openParityLink(HTTP_DRIVER);
  memoLink = await parityToolchain.openParityLink(MEMO_DRIVER);
}

const dir = mkdtempSync(join(tmpdir(), "vsn-901-"));
let fileSeq = 0;
function dest(name = `f-${fileSeq++}`): string {
  return join(dir, name);
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/small") return new Response(SMALL);
    if (path === "/gzip") {
      return new Response(Bun.gzipSync(Buffer.from(GZ_BODY, "utf8")), {
        headers: { "content-encoding": "gzip" },
      });
    }
    if (path === "/lying") {
      return new Response("pas un gzip", { headers: { "content-encoding": "gzip" } });
    }
    if (path === "/redirect") {
      return new Response(null, { status: 302, headers: { location: "/small" } });
    }
    if (path === "/missing") return new Response("absente", { status: 404 });
    if (path === "/big") return new Response(Buffer.alloc(BIG_BYTES, 0x61));
    return new Response("?", { status: 404 });
  },
});

const BASE = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

async function newSession(link: ParityLink): Promise<number> {
  return (JSON.parse(await link.ask({ op: "httpNew", headers: {} })) as { sid: number }).sid;
}

interface DownloadAnswer {
  ok: boolean;
  size?: number;
  exists?: boolean;
  error?: string;
}

async function download(
  link: ParityLink,
  sid: number,
  path: string,
  opts: { maxBytes?: number } = {},
): Promise<DownloadAnswer> {
  return JSON.parse(
    await link.ask({ op: "httpDownload", sid, url: `${BASE}${path}`, path: dest(), ...opts }),
  ) as DownloadAnswer;
}

describe("une réponse ne dépasse pas son budget d'octets (#901)", () => {
  test.skipIf(skip)("un téléchargement écrit le corps EXACT sur disque", async () => {
    const sid = await newSession(httpLink!);
    const path = dest();
    const res = JSON.parse(
      await httpLink!.ask({ op: "httpDownload", sid, url: `${BASE}/small`, path }),
    ) as DownloadAnswer;
    expect(res).toMatchObject({ ok: true, size: SMALL.length, exists: true });
    expect(readFileSync(path, "utf8")).toBe(SMALL);
  });

  test.skipIf(skip)("gzip est décompressé en flux", async () => {
    const sid = await newSession(httpLink!);
    const path = dest();
    const res = JSON.parse(
      await httpLink!.ask({ op: "httpDownload", sid, url: `${BASE}/gzip`, path }),
    ) as DownloadAnswer;
    expect(res.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(GZ_BODY);
  });

  test.skipIf(skip)("un gzip menteur garde les octets bruts", async () => {
    const sid = await newSession(httpLink!);
    const path = dest();
    const res = JSON.parse(
      await httpLink!.ask({ op: "httpDownload", sid, url: `${BASE}/lying`, path }),
    ) as DownloadAnswer;
    expect(res.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("pas un gzip");
  });

  test.skipIf(skip)("une redirection est suivie", async () => {
    const sid = await newSession(httpLink!);
    const path = dest();
    const res = JSON.parse(
      await httpLink!.ask({ op: "httpDownload", sid, url: `${BASE}/redirect`, path }),
    ) as DownloadAnswer;
    expect(res.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(SMALL);
  });

  test.skipIf(skip)("un plafond dépassé ne laisse AUCUN fichier", async () => {
    const sid = await newSession(httpLink!);
    const before = new Set(readdirSync(dir));
    const res = await download(httpLink!, sid, "/small", { maxBytes: 4 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("IOException");
    expect(res.exists).toBe(false);
    // Aucun `.part` orphelin non plus.
    expect([...readdirSync(dir)].filter((name) => !before.has(name))).toEqual([]);
  });

  test.skipIf(skip)("une erreur HTTP ne crée pas de fichier", async () => {
    const sid = await newSession(httpLink!);
    const res = await download(httpLink!, sid, "/missing");
    expect(res.ok).toBe(false);
    expect(res.exists).toBe(false);
  });
});

describe("le corps ne passe pas par la mémoire (preuve basse mémoire)", () => {
  test.skipIf(skip)("32 Mio vers disque avec une heap de 32 Mio", async () => {
    // Une implémentation qui matérialise le corps (ByteArray + copie) meurt
    // ici en OutOfMemoryError ; le flux de 8 Kio, lui, tient.
    const low = await parityToolchain.openParityLink(HTTP_DRIVER, { jvmFlags: ["-Xmx32m"] });
    try {
      const sid = await newSession(low);
      const path = dest();
      const res = JSON.parse(
        await low.ask({
          op: "httpDownload",
          sid,
          url: `${BASE}/big`,
          path,
          maxBytes: 64 * 1024 * 1024,
        }),
      ) as DownloadAnswer;
      expect(res.ok).toBe(true);
      expect(res.size).toBe(BIG_BYTES);
    } finally {
      low.close();
    }
  });
});

describe("la taille UTF-8 du JSON est exacte", () => {
  const CASES = [
    '{"a":"é"}',
    '{"emoji":"😀","n":1}',
    '{"quote":"\\"","slash":"\\\\"}',
    '{"control":"\\u0001","tab":"\\t"}',
    '{"nested":[[1,2],{"x":true}],"nil":null}',
    '{"lone":"\\ud800"}',
    '[]',
    '{}',
  ];

  test.skipIf(skip)("utf8Size = longueur des octets sérialisés", async () => {
    for (const text of CASES) {
      const parsed = JSON.parse(text);
      const expected = Buffer.byteLength(JSON.stringify(parsed), "utf8");
      const res = JSON.parse(await httpLink!.ask({ op: "jsonSize", text, raw: text })) as {
        size: number;
        utf8: number;
        length: number;
      };
      expect({ text, size: res.size, utf8: res.utf8 }).toEqual({ text, size: expected, utf8: expected });
      expect(res.length).toBe(Buffer.byteLength(text, "utf8"));
    }
  });
});

describe("la mémo est bornée par OCTETS, pas par entrées (#901)", () => {
  // `{"v":"é"*30}` = 68 octets ; une entrée = clé (1) + valeur = 69.
  const SMALL_VALUE = JSON.stringify({ v: "é".repeat(30) });

  test.skipIf(skip)("les budgets par défaut sont annoncés", async () => {
    const res = JSON.parse(await memoLink!.ask({ op: "budget", steps: [] })) as {
      maxBytes: number;
      maxEntryBytes: number;
    };
    expect(res.maxBytes).toBe(4 * 1024 * 1024);
    expect(res.maxEntryBytes).toBe(1024 * 1024);
  });

  test.skipIf(skip)("le budget TOTAL évince la plus ancienne", async () => {
    const res = JSON.parse(
      await memoLink!.ask({
        op: "budget",
        maxBytes: 100,
        maxEntryBytes: 100,
        steps: [
          { op: "put", key: "a", value: SMALL_VALUE },
          { op: "put", key: "b", value: SMALL_VALUE },
          { op: "get", key: "a" },
          { op: "get", key: "b" },
        ],
      }),
    ) as { size: number; bytes: number; hits: boolean[] };
    expect(res.size).toBe(1);
    expect(res.bytes).toBeLessThanOrEqual(100);
    expect(res.hits).toEqual([false, true]);
  });

  test.skipIf(skip)("une entrée au-dessus de son budget est REFUSÉE", async () => {
    const res = JSON.parse(
      await memoLink!.ask({
        op: "budget",
        maxBytes: 1000,
        maxEntryBytes: 100,
        steps: [
          { op: "put", key: "gros", value: JSON.stringify({ v: "a".repeat(200) }) },
          { op: "get", key: "gros" },
        ],
      }),
    ) as { size: number; bytes: number; hits: boolean[] };
    expect(res.size).toBe(0);
    expect(res.bytes).toBe(0);
    expect(res.hits).toEqual([false]);
  });

  test.skipIf(skip)("les entrées périmées ne consomment plus le budget", async () => {
    const res = JSON.parse(
      await memoLink!.ask({
        op: "budget",
        ttlMs: 1000,
        maxBytes: 100,
        maxEntryBytes: 100,
        steps: [
          { op: "put", key: "a", value: SMALL_VALUE },
          { op: "now", at: 2000 },
          { op: "put", key: "b", value: SMALL_VALUE },
          { op: "get", key: "a" },
          { op: "get", key: "b" },
        ],
      }),
    ) as { size: number; bytes: number; hits: boolean[] };
    expect(res.size).toBe(1);
    expect(res.bytes).toBeLessThanOrEqual(100);
    expect(res.hits).toEqual([false, true]);
  });

  test.skipIf(skip)("le nombre d'entrées reste borné", async () => {
    const res = JSON.parse(
      await memoLink!.ask({
        op: "budget",
        maxEntries: 2,
        steps: [
          { op: "put", key: "a", value: "1" },
          { op: "put", key: "b", value: "2" },
          { op: "put", key: "c", value: "3" },
        ],
      }),
    ) as { size: number };
    expect(res.size).toBe(2);
  });
});

describe("le dernier échange et les pièces jointes ne retiennent rien (#901)", () => {
  test("la réponse HTTP n'est plus gardée sur la session", () => {
    // `lastResponse` retenait texte + octets (jusqu'à 10 Mio) pour toujours.
    const communication = readFileSync(COMMUNICATION, "utf8");
    expect(communication).not.toContain("lastResponse");
  });

  test("la pièce jointe est téléchargée en FLUX puis adoptée", () => {
    const assignments = readFileSync(ASSIGNMENTS, "utf8");
    expect(assignments).toContain("file.download(dest, DownloadedFiles.MAX_BYTES)");
    expect(assignments).not.toContain("file.data()");
    const attachments = readFileSync(ATTACHMENTS, "utf8");
    expect(attachments).toContain("DownloadedFiles.adopt(");
  });
});

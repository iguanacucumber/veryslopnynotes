// #474 : la session HTTP NEGOCIE la compression et décompresse la réponse.
//
// Le port Kotlin demandait la compression à l'établissement, mais
// `HttpURLConnection` ne décompresse QUE ce qu'il a lui-même demandé : la
// réponse arrivait donc en clair alors que le serveur l'avait compressée.
//
// Le test joue le VRAI `HttpSession` compilé (pilote de parité) contre un
// serveur local qui se comporte comme un établissement : il compresse SA
// réponse quand le client demande `gzip`, et ne le fait pas sinon.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT (jamais un faux vert).
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PronoteParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

/** Corps de test : accentué et répété (un gzip réel). */
const BODY = "EDT de la semaine 42 — cours, devoirs, DS. ".repeat(80);
const GZ = Bun.gzipSync(Buffer.from(BODY, "utf8"));

/** Ce que le serveur a VU de la requête (`accept-encoding`). */
const seen: string[] = [];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname;
    const accept = req.headers.get("accept-encoding") ?? "";
    seen.push(accept);
    if (path === "/gzip") {
      // Établissement qui compresse sa réponse. Le client DOIT la rendre
      // lisible : sans décompression, il reçoit des octets illisibles.
      return new Response(GZ, {
        headers: { "content-encoding": "gzip", "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (path === "/lying") {
      // Annonce `gzip` mais n'envoie pas un gzip : la réponse doit SURVIVRE.
      return new Response("pas un flux gzip", {
        headers: { "content-encoding": "gzip", "content-type": "text/plain; charset=utf-8" },
      });
    }
    // /plain : pas de compression, rien à décompresser.
    return new Response(BODY, { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
});

const BASE = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
});

interface HttpAnswer {
  status: number;
  ok: boolean;
  text: string;
  headers: Record<string, string[]>;
}

async function httpGet(path: string, headers?: Record<string, string>): Promise<HttpAnswer> {
  const sid = (JSON.parse(await link!.ask({ op: "httpNew", headers: {} })) as { sid: number }).sid;
  const raw = await link!.ask({
    op: "httpReq",
    sid,
    method: "GET",
    url: `${BASE}${path}`,
    opts: headers ? { headers } : {},
  });
  return JSON.parse(raw) as HttpAnswer;
}

describe("la session HTTP compresse le transport (#474)", () => {
  test.skipIf(skip)("la requête porte `Accept-Encoding: gzip`", async () => {
    seen.length = 0;
    await httpGet("/plain");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.toLowerCase()).toContain("gzip");
  });

  test.skipIf(skip)("un en-tête posé par l'appelant n'est pas écrasé", async () => {
    seen.length = 0;
    await httpGet("/plain", { "Accept-Encoding": "identity" });
    expect(seen[0]?.toLowerCase()).toBe("identity");
  });

  test.skipIf(skip)("une réponse gzip est rendue lisible", async () => {
    const gz = await httpGet("/gzip");
    expect(gz.status).toBe(200);
    // Le corps reçu doit être le texte d'origine, pas les octets compressés.
    expect(gz.text).toBe(BODY);
  });

  test.skipIf(skip)("une réponse sans compression est inchangée", async () => {
    const plain = await httpGet("/plain");
    expect(plain.status).toBe(200);
    expect(plain.text).toBe(BODY);
    // Même serveur, deux transports : les OCTETS reçus sont identiques.
    const gz = await httpGet("/gzip");
    expect(gz.text).toBe(plain.text);
  });

  test.skipIf(skip)("une décompression impossible ne perd pas la réponse", async () => {
    // Le serveur annonce `gzip` mais envoie autre chose : les octets BRUTS
    // sont conservés (on ne jette jamais la réponse).
    const res = await httpGet("/lying");
    expect(res.status).toBe(200);
    expect(res.text).toBe("pas un flux gzip");
  });
});

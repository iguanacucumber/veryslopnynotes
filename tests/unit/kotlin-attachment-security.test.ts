// Sécurité des pièces jointes (#885, #884) : la vraie `Attachment` et le vrai
// `HttpSession` tournent contre des serveurs locaux. Une `ref` hors origine,
// un lien `type == 0`, une page HTML/JSON servie en 200 et un statut d'erreur
// sont refusés AVANT d'écrire quoi que ce soit ; le corps d'erreur n'est jamais
// lu, et aucun cookie d'établissement ne part vers un autre hôte.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PronoteParityMain.kt");
const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

const dir = mkdtempSync(join(tmpdir(), "vsn-attachments-"));
let fileSeq = 0;
function dest(): string {
  return join(dir, `f-${fileSeq++}`);
}

const PDF = "%PDF-1.4 piece jointe de test";
const SECRET = "CORPS D'ERREUR QUI NE DOIT JAMAIS ETRE ECRIT";

let evilHits = 0;
const cookiesSeen: Array<{ host: string; cookie: string }> = [];

const server = Bun.serve({
  port: 0,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    if (url.hostname === "127.0.0.2") evilHits += 1;
    if (url.pathname.endsWith("/echo-cookie")) {
      cookiesSeen.push({ host: url.hostname, cookie: req.headers.get("cookie") ?? "" });
      return new Response("ok");
    }
    if (url.pathname === "/evil") return new Response("contenu tiers");

    const name = url.pathname.split("/").pop() ?? "";
    if (name === "html.pdf") {
      return new Response(`<html><body>${SECRET}</body></html>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (name === "json.pdf") {
      return new Response(JSON.stringify({ error: SECRET }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (name === "empty.pdf") return new Response(null, { headers: { "content-type": "application/pdf" } });
    if (name === "unauth.pdf") return new Response(SECRET, { status: 401 });
    if (name === "missing.pdf") return new Response(SECRET, { status: 404 });
    if (name === "boom.pdf") return new Response(SECRET, { status: 503 });
    if (name === "rate.pdf") {
      return new Response(SECRET, { status: 429, headers: { "retry-after": "2" } });
    }
    return new Response(PDF, { headers: { "content-type": "application/pdf" } });
  },
});

const PORT = Number(server.port);
const SCHOOL = `http://127.0.0.1:${PORT}/pronote/eleve.html`;
const EXTERNAL = `http://127.0.0.2:${PORT}`;

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

interface FetchAnswer {
  ok: boolean;
  size?: number;
  exists?: boolean;
  error?: string;
  message?: string;
  httpStatus?: number;
}

function payload(id: string, type: number, label: string, url?: string): string {
  return JSON.stringify({ N: id, G: type, L: label, ...(url ? { url } : {}) });
}

async function fetchAttachment(
  json: string,
  opts: { site?: string; maxBytes?: number; path?: string } = {},
): Promise<FetchAnswer> {
  const path = opts.path ?? dest();
  return JSON.parse(
    await link!.ask({
      op: "attachmentFetch",
      site: opts.site ?? SCHOOL,
      json,
      path,
      ...(opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes }),
    }),
  ) as FetchAnswer;
}

async function guard(site: string, type: number, ref: string): Promise<{ url?: string; error?: string }> {
  const raw = await link!.ask({ op: "attachmentUrl", site, type, ref }, { allowError: true });
  const parsed = JSON.parse(raw) as { url?: string; error?: string };
  return parsed;
}

describe("la pièce jointe reste sur l'origine de l'établissement (#885)", () => {
  test.skipIf(skip)("une pièce jointe du site se télécharge", async () => {
    const path = dest();
    const res = await fetchAttachment(payload("1", 1, "ok.pdf"), { path });
    expect(res).toMatchObject({ ok: true, exists: true });
    expect(readFileSync(path, "utf8")).toBe(PDF);
    expect(evilHits).toBe(0);
  });

  test.skipIf(skip)("un lien type 0 n'est jamais téléchargé, même sur l'école", async () => {
    const before = evilHits;
    const external = await fetchAttachment(
      payload("2", 0, "lien", `${EXTERNAL}/evil`),
    );
    expect(external.ok).toBe(false);
    expect(external.error).toBe("AttachmentRefused");
    expect(external.exists).toBe(false);
    // Aucune requête vers l'hôte externe : le refus précède le réseau.
    expect(evilHits).toBe(before);

    const schoolLink = await fetchAttachment(
      payload("3", 0, "lien", `http://127.0.0.1:${PORT}/evil`),
    );
    expect(schoolLink.ok).toBe(false);
    expect(schoolLink.error).toBe("AttachmentRefused");
  });

  test.skipIf(skip)("les hôtes non scolaires et les URL de fichier sont refusés", async () => {
    const schoolOrigin = `http://127.0.0.1:${PORT}/pronote`;
    const rejected = [
      `${EXTERNAL}/evil`,
      "file:///etc/passwd",
      "data:application/pdf;base64,AA",
      "//attaquant.example/x",
      "https://etablissement@attaquant.example/x",
      `http://127.0.0.1:${PORT + 1}/pronote/x`,
      "https://127.0.0.1/pronote/x",
      "javascript:alert(1)",
    ];
    for (const ref of rejected) {
      const answer = await guard(SCHOOL, 1, ref);
      expect({ ref, error: answer.error }).toEqual({ ref, error: "AttachmentRefused" });
    }
    // Même origine = acceptée, schéma et port par défaut compris.
    const kept = await guard(schoolOrigin, 1, `${schoolOrigin}/FichiersExternes/x/f.pdf`);
    expect(kept.url).toBe(`${schoolOrigin}/FichiersExternes/x/f.pdf`);
    expect((await guard("https://ecole.example", 1, "https://ecole.example:443/f")).url).toBe(
      "https://ecole.example:443/f",
    );
  });

  test.skipIf(skip)("aucun cookie d'établissement ne part vers un autre hôte", async () => {
    const sid = (JSON.parse(await link!.ask({ op: "httpNew", headers: {} })) as { sid: number }).sid;
    await link!.ask({
      op: "httpCookieSet",
      sid,
      header: "pronote_session=secret; Path=/pronote",
      url: `http://127.0.0.1:${PORT}/pronote/`,
    });
    cookiesSeen.length = 0;
    await link!.ask({ op: "httpReq", sid, method: "GET", url: `${EXTERNAL}/echo-cookie`, opts: {} });
    await link!.ask({
      op: "httpReq",
      sid,
      method: "GET",
      url: `http://127.0.0.1:${PORT}/pronote/echo-cookie`,
      opts: {},
    });
    expect(cookiesSeen).toEqual([
      { host: "127.0.0.2", cookie: "" },
      { host: "127.0.0.1", cookie: "pronote_session=secret" },
    ]);
  });
});

describe("un téléchargement exige un succès HTTP et un corps de fichier (#884)", () => {
  test.skipIf(skip)("401, 404 et 5xx sont des refus TYPÉS, sans corps enregistré", async () => {
    for (const [name, status] of [
      ["unauth.pdf", 401],
      ["missing.pdf", 404],
      ["boom.pdf", 503],
    ] as const) {
      const path = dest();
      const res = await fetchAttachment(payload(name, 1, name), { path });
      expect({ name, ...res }).toMatchObject({
        name,
        ok: false,
        error: "AttachmentHttpError",
        httpStatus: status,
        exists: false,
      });
      expect(existsSync(path)).toBe(false);
      expect(res.message ?? "").not.toContain(SECRET);
    }
    expect(readdirSync(dir).some((f) => f.includes("part"))).toBe(false);
  });

  test.skipIf(skip)("429 garde son type et son Retry-After", async () => {
    const res = await fetchAttachment(payload("rate.pdf", 1, "rate.pdf"));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("RateLimitedError");
    expect(res.httpStatus).toBe(429);
    expect(res.exists).toBe(false);
  });

  test.skipIf(skip)("une page HTML servie en 200 n'est pas une pièce jointe", async () => {
    const path = dest();
    const res = await fetchAttachment(payload("html.pdf", 1, "html.pdf"), { path });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("AttachmentRefused");
    expect(existsSync(path)).toBe(false);
  });

  test.skipIf(skip)("un JSON d'erreur servi en 200 n'est pas une pièce jointe", async () => {
    const res = await fetchAttachment(payload("json.pdf", 1, "json.pdf"));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("AttachmentRefused");
    expect(res.exists).toBe(false);
  });

  test.skipIf(skip)("un corps vide ne crée pas de fichier", async () => {
    const res = await fetchAttachment(payload("empty.pdf", 1, "empty.pdf"));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("AttachmentRefused");
    expect(res.exists).toBe(false);
  });

  test.skipIf(skip)("une longueur annoncée au-dessus du plafond est refusée avant lecture", async () => {
    const raw = await declaredLengthServer();
    try {
      const res = await fetchAttachment(payload("1", 1, "ok.pdf"), {
        site: `http://127.0.0.1:${raw.port}/pronote/eleve.html`,
        maxBytes: 1024,
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBe("IOException");
      expect(res.exists).toBe(false);
      // Le refus vient des en-têtes : le serveur n'a pas eu à envoyer de corps.
      expect(raw.bodyBytesSent()).toBeLessThanOrEqual(1);
    } finally {
      raw.close();
    }
  });
});

/** Serveur brut : seul moyen de mentir sur `Content-Length`. */
async function declaredLengthServer(): Promise<{
  port: number;
  bodyBytesSent: () => number;
  close: () => void;
}> {
  let sent = 0;
  const sockets = new Set<Socket>();
  const server = createServer((sock) => {
    sockets.add(sock);
    sock.on("error", () => {});
    sock.on("close", () => sockets.delete(sock));
    sock.once("data", () => {
      sock.write(
        "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 999999999\r\nConnection: close\r\n\r\n",
      );
      // Le client doit refuser avant de demander le corps ; s'il insiste, le
      // compteur le prouve.
      const timer = setInterval(() => {
        if (sock.destroyed) {
          clearInterval(timer);
          return;
        }
        sent += 1;
        sock.write("x");
      }, 200);
      sock.on("close", () => clearInterval(timer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    bodyBytesSent: () => sent,
    close() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

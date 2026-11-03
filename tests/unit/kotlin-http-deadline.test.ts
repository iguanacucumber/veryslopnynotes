// #868 : l'échéance est TOTALE (connect, redirects, en-têtes, corps). Un
// serveur qui s'égoutte ne repousse jamais l'échéance, et un abandon de
// l'appelant coupe la connexion en vol. Le VRAI `HttpSession` est piloté par le
// harnais Kotlin ; outillage absent = SKIP BRUYANT.
import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PronoteParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

/** Serveur brut : seul moyen d'observer la fermeture du socket. */
interface RawServer {
  port: number;
  closed: Promise<void>;
  close(): void;
}

function rawServer(onRequest: (sock: Socket) => void): Promise<RawServer> {
  return new Promise((resolve) => {
    const sockets = new Set<Socket>();
    let signalClosed: () => void = () => {};
    const closed = new Promise<void>((res) => {
      signalClosed = res;
    });
    const server = createServer((sock) => {
      sockets.add(sock);
      let started = false;
      sock.on("data", () => {
        if (started) return;
        started = true;
        onRequest(sock);
      });
      sock.on("end", () => signalClosed());
      sock.on("close", () => {
        sockets.delete(sock);
        signalClosed();
      });
      sock.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        closed,
        close() {
          for (const s of sockets) s.destroy();
          server.close();
        },
      });
    });
  });
}

/** `closed` si le client a refermé le socket, `timeout` sinon. */
function closedOrTimeout(raw: RawServer, ms: number): Promise<string> {
  return Promise.race([
    raw.closed.then(() => "closed"),
    new Promise<string>((res) => setTimeout(() => res("timeout"), ms)),
  ]);
}

/** En-têtes 200 + corps sans fin, 16 octets toutes les 30 ms. */
async function trickleServer(): Promise<RawServer & { chunks: () => number }> {
  let chunks = 0;
  const raw = await rawServer((sock) => {
    sock.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1000000\r\nConnection: keep-alive\r\n\r\n");
    const timer = setInterval(() => {
      if (sock.destroyed) {
        clearInterval(timer);
        return;
      }
      chunks += 1;
      sock.write("x".repeat(16));
    }, 30);
    sock.on("close", () => clearInterval(timer));
  });
  return { ...raw, chunks: () => chunks };
}

/** En-têtes 302 après 300 ms : la lecture DES EN-TÊTES doit déjà être bornée. */
async function slowRedirectServer(): Promise<RawServer> {
  return rawServer((sock) => {
    setTimeout(() => {
      if (sock.destroyed) return;
      sock.write(
        "HTTP/1.1 302 Found\r\nLocation: /trickle\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n",
      );
    }, 300);
  });
}

async function newSession(): Promise<number> {
  return (JSON.parse(await link!.ask({ op: "httpNew", headers: {} })) as { sid: number }).sid;
}

interface HttpAnswer {
  error?: string;
  message?: string;
  status?: number;
  text?: string;
}

describe("échéance totale de la requête scolaire (#868)", () => {
  test.skipIf(skip)("un corps qui s'égoutte expire à l'échéance, jamais à chaque lecture", async () => {
    const server = await trickleServer();
    try {
      const sid = await newSession();
      const started = Date.now();
      const raw = await link!.ask({
        op: "httpReq",
        sid,
        method: "GET",
        url: `http://127.0.0.1:${server.port}/trickle`,
        opts: { deadlineMs: 300 },
      }, { allowError: true });
      const elapsed = Date.now() - started;
      const answer = JSON.parse(raw) as HttpAnswer;
      // 30 ms entre deux octets < 15 s : sans échéance totale, la boucle
      // continuerait jusqu'aux 1 000 000 d'octets (des heures).
      expect(answer.error).toBe("SocketTimeoutException");
      expect(elapsed).toBeLessThan(2000);
      expect(server.chunks()).toBeLessThan(100);
      // Abandon = socket fermé, pas laissé au cache keep-alive.
      expect(await closedOrTimeout(server, 5000)).toBe("closed");
    } finally {
      server.close();
    }
  }, 15000);

  test.skipIf(skip)("la même échéance couvre la lecture des en-têtes de redirect", async () => {
    const server = await slowRedirectServer();
    try {
      const sid = await newSession();
      const started = Date.now();
      const raw = await link!.ask({
        op: "httpReq",
        sid,
        method: "GET",
        url: `http://127.0.0.1:${server.port}/r302`,
        opts: { deadlineMs: 200 },
      }, { allowError: true });
      const elapsed = Date.now() - started;
      expect((JSON.parse(raw) as HttpAnswer).error).toBe("SocketTimeoutException");
      // Un délai REMIS À ZÉRO par redirect/lecture attendrait 300 ms puis 15 s.
      expect(elapsed).toBeLessThan(1500);
      expect(await closedOrTimeout(server, 5000)).toBe("closed");
    } finally {
      server.close();
    }
  }, 15000);

  test.skipIf(skip)("un premier octet lent reste permis sous l'échéance", async () => {
    const server = await rawServer((sock) => {
      setTimeout(() => {
        if (sock.destroyed) return;
        sock.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok");
      }, 400);
    });
    try {
      const sid = await newSession();
      const raw = await link!.ask({
        op: "httpReq",
        sid,
        method: "GET",
        url: `http://127.0.0.1:${server.port}/slow-headers`,
        opts: { deadlineMs: 2000 },
      });
      const answer = JSON.parse(raw) as HttpAnswer;
      expect(answer.status).toBe(200);
      expect(answer.text).toBe("ok");
    } finally {
      server.close();
    }
  }, 15000);

  test.skipIf(skip)("un trou plus court que l'échéance n'échoue pas", async () => {
    const server = await rawServer((sock) => {
      sock.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\n");
      setTimeout(() => {
        if (!sock.destroyed) sock.write("ok");
      }, 400);
    });
    try {
      const sid = await newSession();
      const raw = await link!.ask({
        op: "httpReq",
        sid,
        method: "GET",
        url: `http://127.0.0.1:${server.port}/gap`,
        opts: { deadlineMs: 2000 },
      });
      const answer = JSON.parse(raw) as HttpAnswer;
      expect(answer.status).toBe(200);
      expect(answer.text).toBe("ok");
    } finally {
      server.close();
    }
  }, 15000);

  test.skipIf(skip)("un trou plus long que la tranche de lecture, sous l'échéance, n'échoue pas", async () => {
    const server = await rawServer((sock) => {
      sock.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\n");
      setTimeout(() => {
        if (!sock.destroyed) sock.write("ok");
      }, 3000);
    });
    try {
      const sid = await newSession();
      const raw = await link!.ask({
        op: "httpReq",
        sid,
        method: "GET",
        url: `http://127.0.0.1:${server.port}/long-gap`,
        opts: { deadlineMs: 6000 },
      });
      const answer = JSON.parse(raw) as HttpAnswer;
      expect(answer.status).toBe(200);
      expect(answer.text).toBe("ok");
    } finally {
      server.close();
    }
  }, 15000);

  test.skipIf(skip)("un abandon de l'appelant coupe la connexion en vol", async () => {
    let signalHeaders: () => void = () => {};
    const headersWritten = new Promise<void>((res) => {
      signalHeaders = res;
    });
    let requests = 0;
    const server = await rawServer((sock) => {
      requests += 1;
      if (requests === 1) {
        // Chauffe la pile HTTP de la JVM : le test ne dépend pas du temps de
        // chargement des classes de la requête asynchrone.
        sock.end("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok");
        return;
      }
      // En-têtes seuls : le client est bloqué dans le corps, sans échéance
      // proche (5 s). Seul l'abandon doit le sortir.
      sock.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1000000\r\n\r\n");
      signalHeaders();
    });
    try {
      const sid = await newSession();
      await link!.ask({
        op: "httpReq",
        sid,
        method: "GET",
        url: `http://127.0.0.1:${server.port}/warm`,
      });
      const rid = (JSON.parse(
        await link!.ask({
          op: "httpReqAsync",
          sid,
          method: "GET",
          url: `http://127.0.0.1:${server.port}/stall`,
          opts: { deadlineMs: 5000 },
        }),
      ) as { rid: number }).rid;
      const started = Date.now();
      // Le client est dans le CORPS (en-têtes écrits depuis > 300 ms) : le
      // test ne dépend pas de la vitesse de démarrage de la JVM.
      await headersWritten;
      await Bun.sleep(300);
      const cancelled = JSON.parse(await link!.ask({ op: "httpCancelReq", rid })) as {
        found: boolean;
        cancelled: boolean;
      };
      expect(cancelled.found).toBe(true);
      expect(cancelled.cancelled).toBe(true);
      const raw = await link!.ask({ op: "httpAwait", rid, timeoutMs: 4000 });
      const awaited = JSON.parse(raw) as { pending: boolean; line?: string };
      expect(awaited.pending).toBe(false);
      const answer = JSON.parse(awaited.line!) as HttpAnswer;
      // `disconnect()` peut rendre `SocketException` avant le contrôle de
      // boucle ; le point prouvé est le DÉLAI et la fermeture, pas le nom exact.
      expect(answer.error).toMatch(/RequestCancelled|SocketException|IOException/);
      expect(Date.now() - started).toBeLessThan(3500);
      expect(await closedOrTimeout(server, 5000)).toBe("closed");
    } finally {
      server.close();
    }
  }, 15000);
});

afterAll(() => {
  link?.close();
});

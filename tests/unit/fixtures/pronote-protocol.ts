// Parité TS <-> Kotlin du protocole (crypto + communication + HTTP, #200, #202).
//
// Même principe que `kotlin-domain-parity.test.ts`, mais le « calcul » inclut le
// FIL : un serveur PRONOTE factice (`Bun.serve` sur 127.0.0.1) parle aux DEUX
// implémentations — la référence `pronotets` ET le port compilé — et le test
// compare ce que le serveur a VU (octets normalisés de l'aléa documenté) et ce
// que les clients ont COMPRIS (enveloppes, erreurs typées).
//
// L'aléa est fixé là où le protocole l'exige aléatoire (`aesIvTemp` injecté des
// deux côtés : champ public aussi côté TS) : tout le reste DOIT être
// octet-identique. Seules exceptions, documentées cas par cas :
// - `Uuid` RSA (`http` présent) : bourrage PKCS#1 aléatoire — longueur et
//   structure vérifiées par exponentiation (`modPow`), pas les octets ;
// - `deflate` : Java et zlib produisent deux flux valides différents — le
//   contenu inflaté est comparé, pas le flux ;
// - `lastPing` : horloge murale, exclu.
import { expect } from "bun:test";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { CookieJar } from "tough-cookie";
import { Communication, Encryption, KeepAlive } from "pronotets";
import { enBytes, prepareOnglets } from "../../../node_modules/pronotets/dist/communication.js";
import { md5, sha256HexUpper } from "../../../node_modules/pronotets/dist/crypto.js";
import { HttpSession } from "../../../node_modules/pronotets/dist/http.js";
import { ROOT, canonTs, parityToolchain, type ParityLink } from "./kotlin-harness";

export const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PronoteParityMain.kt");

export const skip = parityToolchain.skipReason !== null;

export let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

export async function ask(op: unknown, allowError = false): Promise<string> {
  return link!.ask(op, { allowError });
}

/** Ligne du pilote → canonique TS, contexte dans le message (ordre des clés ignoré). */
export async function expectKt(op: unknown, tsValue: unknown, ctx: string): Promise<void> {
  const kt = await ask(op);
  expect(`${ctx} -> ${canonTs(JSON.parse(kt))}`).toBe(`${ctx} -> ${canonTs(tsValue)}`);
}

/** `{"error","message"}` du pilote → `{name, message}`, comme un `catch` TS. */
export function portError(line: string): { name: string; message: string } {
  const body = JSON.parse(line) as { error: string; message: string };
  return { name: body.error, message: body.message };
}

export function tsErrorOf(fn: () => unknown): { name: string; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    return { name: (e as Error).name, message: (e as Error).message };
  }
}

export async function tsErrorOfAsync(fn: () => Promise<unknown>): Promise<{ name: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return { name: (e as Error).name, message: (e as Error).message };
  }
}

// --- Outillage crypto côté test (indépendant des deux implémentations) -------

export const TEMP_HEX = "00112233445566778899aabbccddeeff";
export const K0_HEX = createHash("md5").update(Buffer.alloc(0)).digest("hex");
export const IV1_HEX = createHash("md5").update(Buffer.from(TEMP_HEX, "hex")).digest("hex");

export function tsAesEncrypt(keyHex: string, ivHex: string, data: Buffer): Buffer {
  const c = createCipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
  return Buffer.concat([c.update(data), c.final()]);
}

export function tsAesDecrypt(keyHex: string, ivHex: string, data: Buffer): Buffer {
  const d = createDecipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
  return Buffer.concat([d.update(data), d.final()]);
}

/** Exponentiation modulaire (revérification indépendante de JCE sur bloc EM fixé). */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/**
 * RSA-1024 PKCS#1 v1.5 : ce qui est vérifiable SANS la clé privée.
 *
 * Le chiffré est opaque par conception (bourrage aléatoire) : on ne peut ni le
 * comparer ni y lire la structure sans l'exposant privé, que seul le serveur
 * PRONOTE détient. Trois preuves partielles, qui ensemble ferment le risque :
 * 1. `rsaKey` : le module et l'exposant sont exacts (une coquille = test rouge) ;
 * 2. `rsaNoPad` : le test construit un bloc EM DÉTERMINISTE (`00 02 FF…FF 00 || M`)
 *    et revérifie l'exponentiation par lui-même (`modPow` indépendant de JCE) —
 *    prouve la clé + le moteur JCE ;
 * 3. `rsa` : 128 octets (taille du module), comme la référence.
 * La preuve totale (le serveur déchiffre l'`Uuid`) n'existe qu'en ligne.
 */
export function checkRsaHeader(cipherHex: string, ctx: string): void {
  const raw = Buffer.from(cipherHex, "hex");
  expect(`${ctx} length=${raw.length}`).toBe(`${ctx} length=128`);
}

// Clé codée en dur (`pronotets` `crypto.js`, `eleve.js` en amont) : recopiée
// comme ORACLE de test. Si elle change en amont, ce test CASSE — voulu : un
// changement de clé doit être délibéré, jamais silencieux.
export const RSA_N_DEC = "130337874517286041778445012253514395801341480334668979416920989365464528904618150245388048105865059387076357492684573172203245221386376405947824377827224846860699130638566643129067735803555082190977267155957271492183684665050351182476506458843580431717209261903043895605014125081521285387341454154194253026277";
export const RSA_E_DEC = "65537";

// --- Serveur PRONOTE factice --------------------------------------------------

export interface RecordedReq {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface StubBehavior {
  /** Attributs de la page HTML (`Start({…})`), ou file d'attente par appel. */
  htmlQueue: string[];
  /** La page rajoute ces `Set-Cookie` au GET initial. */
  pageCookies: string[];
  /** Réponse à `FonctionParametres` (intérieur de `dataSec`). */
  paramsData: unknown;
  /** Réponse aux autres fonctions : `(id, inner) => inner`. */
  answer?: (id: string, inner: Record<string, unknown>) => unknown;
  /** Prochain POST → ce statut + corps (test d'erreur HTTP). */
  nextPostStatus?: { status: number; body: string };
  /** Prochain POST → ce corps BRUT (erreurs `Erreur`, JSON cassé). */
  nextRaw?: string;
  /** Prochain POST → cette enveloppe JSON (raccourci de `nextRaw`). */
  nextEnvelope?: unknown;
  /** Prochain POST → `{dataSec: <hex>}` brut (déflate corrompu). */
  nextDataSec?: string;
  /** Clé/IV des POST après `afterAuth` (`FonctionParametres` = K0/zéros). */
  postKeyHex: string;
  postIvHex: string;
}

export function defaultBehavior(htmlAttrs: string): StubBehavior {
  return {
    htmlQueue: [htmlAttrs],
    pageCookies: [],
    paramsData: { donnees: [1, 2, 3] },
    postKeyHex: "",
    postIvHex: "",
  };
}

export interface Stub {
  base: string;
  requests: RecordedReq[];
  /** Port distant vu par le serveur, un par requête (`null` si indisponible) —
   *  c'est la preuve du keep-alive : un seul port pour N requêtes (#309). */
  remotePorts: (number | null)[];
  gets: number;
  behavior: StubBehavior;
  close(): void;
}

export function startStub(htmlAttrs: string): Stub {
  const stub = { gets: 0 } as Stub;
  stub.behavior = defaultBehavior(htmlAttrs);
  stub.requests = [];
  stub.remotePorts = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      stub.remotePorts.push(srv.requestIP(req)?.port ?? null);
      // La racine sert aussi de page PRONOTE : un site d'établissement SANS
      // chemin (`https://host`) vise la racine, pas une page à nommer (#429).
      if (req.method === "GET" && (url.pathname.endsWith("/eleve.html") || url.pathname === "/")) {
        stub.gets++;
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of req.headers) headers[k] = v;
        stub.requests.push({ method: "GET", path: url.pathname, headers, body: "" });
        const html = stub.behavior.htmlQueue.length > 1 ? (stub.behavior.htmlQueue.shift() as string) : stub.behavior.htmlQueue[0];
        const resHeaders = new Headers({ "Content-Type": "text/html" });
        for (const c of stub.behavior.pageCookies) resHeaders.append("Set-Cookie", c);
        return new Response(`<html><body onload="Start({${html}})"></body></html>`, { headers: resHeaders });
      }
      if (req.method === "GET" && url.pathname.endsWith("/r302")) {
        return new Response(null, { status: 302, headers: { Location: "/final" } });
      }
      if (req.method === "POST" && url.pathname.endsWith("/post302")) {
        return new Response(null, { status: 302, headers: { Location: "/final" } });
      }
      if (req.method === "POST" && url.pathname.endsWith("/post307")) {
        return new Response(null, { status: 307, headers: { Location: "/final" } });
      }
      if (url.pathname.endsWith("/final")) {
        return (async () => {
          const body = req.method === "POST" ? await req.text() : "";
          return Response.json({ method: req.method, body });
        })();
      }
      if (url.pathname.endsWith("/setCookies")) {
        const headers = new Headers();
        headers.append("Set-Cookie", "a=1; Path=/");
        headers.append("Set-Cookie", "b=2; Path=/sub; Max-Age=10000");
        headers.append("Set-Cookie", "dead=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
        return new Response("cookies", { headers });
      }
      if (url.pathname.endsWith("/echoCookies")) {
        return new Response(req.headers.get("cookie") ?? "(vide)");
      }
      if (url.pathname.endsWith("/params")) {
        return new Response(url.search);
      }
      if (url.pathname.endsWith("/status500")) {
        return new Response("oops", { status: 500 });
      }
      if (url.pathname.endsWith("/badjson")) {
        return new Response("ceci n'est pas du JSON{", { headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname.includes("/appelfonction/")) {
        return (async () => {
          const body = await req.text();
          const headers: Record<string, string | undefined> = {};
          for (const [k, v] of req.headers) headers[k] = v;
          stub.requests.push({ method: req.method, path: url.pathname, headers, body });
          const b = stub.behavior;
          if (b.nextPostStatus) {
            const s = b.nextPostStatus;
            b.nextPostStatus = undefined;
            return new Response(s.body, { status: s.status });
          }
          if (b.nextRaw !== undefined) {
            const raw = b.nextRaw;
            b.nextRaw = undefined;
            return new Response(raw, { headers: { "Content-Type": "application/json" } });
          }
          if (b.nextEnvelope !== undefined) {
            const e = b.nextEnvelope;
            b.nextEnvelope = undefined;
            return Response.json(e);
          }
          if (b.nextDataSec !== undefined) {
            const d = b.nextDataSec;
            b.nextDataSec = undefined;
            return Response.json({ dataSec: d });
          }
          // Meme lecture que les clients : attribut PRESENT ET NON VIDE (meme
          // `'0'` — verite JS, pas booleen textuel). Le stub ne devine rien d'autre.
          const lastHtml = b.htmlQueue[b.htmlQueue.length - 1] ?? "";
          const attrOf = (name: string): string => {
            const mm = lastHtml.match(new RegExp(name + ":\\s*'([^']*)'"));
            return mm ? (mm[1] as string) : "";
          };
          const cra = attrOf("CrA") !== "";
          const coa = attrOf("CoA") !== "";
          const envelope = JSON.parse(body) as { id: string; no: string; dataSec: unknown };
          const isParams = envelope.id === "FonctionParametres";
          // Requête : (K0, zéros) pour FP (l'IV ne bascule qu'APRÈS sa réponse),
          // (postKey, postIv) ensuite. Réponse : (K0, iv1) pour FP — le client
          // applique `decryptionChange` AVANT de déchiffrer —, (postKey, postIv)
          // sinon. (`iv1` = md5 du temp fixé : le stub le connaît comme le test.)
          const reqKey = isParams ? K0_HEX : b.postKeyHex;
          const reqIv = isParams ? "00000000000000000000000000000000" : b.postIvHex;
          const resKey = isParams ? K0_HEX : b.postKeyHex;
          let inner: unknown;
          if (typeof envelope.dataSec === "string") {
            let raw: Buffer<ArrayBufferLike> = Buffer.from(envelope.dataSec, "hex");
            if (cra) raw = tsAesDecrypt(reqKey, reqIv, raw);
            if (coa) {
              // Requête : HEX(DEFLATE(ASCII(HEX(JSON)))) — double hex côté
              // pronotets (la réponse, elle, est simple hex : asymétrie réelle).
              raw = Buffer.from(inflateRawSync(raw).toString("utf8"), "hex");
            }
            inner = JSON.parse(raw.toString("utf8"));
          } else {
            inner = envelope.dataSec;
          }
          const answer = isParams ? b.paramsData : (b.answer?.(envelope.id, inner as Record<string, unknown>) ?? { echo: inner });
          let dataSec: unknown = answer;
          if (coa) dataSec = deflateRawSync(Buffer.from(JSON.stringify(answer), "utf8"), { level: 6 }).toString("hex").toUpperCase();
          if (cra) {
            const bytes = typeof dataSec === "string" ? Buffer.from(dataSec, "hex") : Buffer.from(JSON.stringify(dataSec), "utf8");
            dataSec = tsAesEncrypt(resKey, IV1_HEX, bytes).toString("hex").toUpperCase();
          }
          return Response.json({ dataSec });
        })();
      }
      return new Response("route inconnue", { status: 404 });
    },
  });
  stub.base = `http://127.0.0.1:${server.port}`;
  stub.close = () => server.stop();
  return stub;
}

export function behaviorKeys(stub: Stub, postKeyHex: string, postIvHex: string): void {
  stub.behavior.postKeyHex = postKeyHex;
  stub.behavior.postIvHex = postIvHex;
}

/**
 * Serveur TCP BRUT : la seule façon de voir le socket se fermer (`Bun.serve`
 * n'expose pas les connexions). Il répond 302 + une `Location` illisible.
 *
 * La réponse porte un CORPS : le client ne lit pas le corps d'une redirection,
 * donc son `disconnect()` ferme VRAIMENT le socket (un corps déjà lu retourne
 * au cache keep-alive de la JVM, et le serveur ne verrait aucun FIN). Le FIN
 * vu par le serveur est donc la preuve externe que la connexion n'a pas fuité.
 */
export interface RawServer {
  port: number;
  /** Résolu quand le client referme le socket. */
  closed: Promise<void>;
  close(): void;
}

export function startRawServer(location: string): Promise<RawServer> {
  return new Promise((resolve) => {
    const sockets = new Set<Socket>();
    let signalClosed: () => void = () => {};
    const closed = new Promise<void>((res) => {
      signalClosed = res;
    });
    const server = createServer((sock) => {
      sockets.add(sock);
      sock.on("data", () => {
        sock.write(
          `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 5\r\nConnection: keep-alive\r\n\r\nhello`,
        );
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
export async function closedOrTimeout(raw: RawServer, ms: number): Promise<string> {
  return Promise.race([
    raw.closed.then(() => "closed"),
    new Promise<string>((res) => setTimeout(() => res("timeout"), ms)),
  ]);
}

/** Normalise l'aléa documenté : `Uuid` du handshake (temp fixé ou RSA). */
export function normalizeBody(body: string, keys: { fp: { keyHex: string; ivHex: string }; post: { keyHex: string; ivHex: string } }): string {
  if (body === "") return "";
  const envelope = JSON.parse(body) as { id: string; dataSec: unknown };
  const keysFor = envelope.id === "FonctionParametres" ? keys.fp : keys.post;
  let inner = envelope.dataSec;
  if (typeof inner === "string") {
    inner = JSON.parse(tsAesDecrypt(keysFor.keyHex, keysFor.ivHex, Buffer.from(inner, "hex")).toString("utf8"));
  }
  if (inner !== null && typeof inner === "object" && "data" in (inner as object)) {
    const data = (inner as { data: Record<string, unknown> }).data;
    if (data !== null && typeof data === "object" && "Uuid" in data) {
      data["Uuid"] = (data["Uuid"] as string).length > 100 ? "RSA" : "TEMP";
    }
  }
  return JSON.stringify({ ...envelope, dataSec: inner });
}

export interface WireReq {
  method: string;
  path: string;
  contentType: string | undefined;
  cookie: string | undefined;
  userAgent: string | undefined;
  body: string;
}

/** En-têtes comparés : les utiles (le reste — `host`, `connection`, `accept`
 *  — dépend du transport, pas du protocole). */
export function wireOf(
  requests: RecordedReq[],
  keys: { fp: { keyHex: string; ivHex: string }; post: { keyHex: string; ivHex: string } },
): WireReq[] {
  return requests.map((r) => ({
    method: r.method,
    path: r.path,
    contentType: r.headers["content-type"],
    cookie: r.headers["cookie"],
    userAgent: r.headers["user-agent"],
    body: normalizeBody(r.body, keys),
  }));
}

// --- Clients des deux côtés ---------------------------------------------------

export function tsSeededComm(stub: Stub, mobile = false): Communication {
  const comm = new Communication(`${stub.base}/pronote/eleve.html`, undefined, mobile);
  (comm.encryption as unknown as Record<string, unknown>)["aesIvTemp"] = Buffer.from(TEMP_HEX, "hex");
  return comm;
}

/** `parseHtml` est publique en JS mais privée dans le `.d.ts` : accès direct. */
export function tsParseHtml(html: string): unknown {
  const probe = new Communication("http://127.0.0.1/x", undefined, false);
  return (probe as unknown as { parseHtml(h: string): unknown }).parseHtml(html);
}

export async function ktSeededComm(stub: Stub, mobile = false): Promise<number> {
  const cid = (JSON.parse(await ask({ op: "commNew", site: `${stub.base}/pronote/eleve.html`, mobile })) as { cid: number }).cid;
  await ask({ op: "commSeed", cid, tempHex: TEMP_HEX });
  return cid;
}


export { ROOT, canonTs, parityToolchain };
export { Communication, Encryption, KeepAlive, enBytes, prepareOnglets, md5, sha256HexUpper, HttpSession, CookieJar, createCipheriv, createDecipheriv, createHash, deflateRawSync, inflateRawSync, readFileSync, join };
export type { AddressInfo, Socket, ParityLink };

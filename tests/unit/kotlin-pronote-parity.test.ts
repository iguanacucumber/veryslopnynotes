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
import { describe, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { join } from "node:path";
import { CookieJar } from "tough-cookie";
import { Communication, Encryption, KeepAlive } from "pronotets";
import { enBytes, enleverAlea, prepareOnglets } from "../../node_modules/pronotets/dist/communication.js";
import { md5, sha256HexUpper } from "../../node_modules/pronotets/dist/crypto.js";
import { HttpSession } from "../../node_modules/pronotets/dist/http.js";
import { ROOT, canonTs, parityToolchain, type ParityLink } from "./fixtures/kotlin-harness";

const PRONOTE = join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote");
const SOURCES = ["Json.kt", "Bytes.kt", "Errors.kt", "Crypto.kt", "HttpSession.kt", "Communication.kt"].map((f) =>
  join(PRONOTE, f),
);
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "PronoteParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  const jar = await parityToolchain.ensureJar("kotlin-pronote-parity", [...SOURCES, DRIVER]);
  link = await parityToolchain.openLink(jar);
}

async function ask(op: unknown, allowError = false): Promise<string> {
  return link!.ask(op, { allowError });
}

/** Ligne du pilote → canonique TS, contexte dans le message (ordre des clés ignoré). */
async function expectKt(op: unknown, tsValue: unknown, ctx: string): Promise<void> {
  const kt = await ask(op);
  expect(`${ctx} -> ${canonTs(JSON.parse(kt))}`).toBe(`${ctx} -> ${canonTs(tsValue)}`);
}

/** `{"error","message"}` du pilote → `{name, message}`, comme un `catch` TS. */
function portError(line: string): { name: string; message: string } {
  const body = JSON.parse(line) as { error: string; message: string };
  return { name: body.error, message: body.message };
}

function tsErrorOf(fn: () => unknown): { name: string; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    return { name: (e as Error).name, message: (e as Error).message };
  }
}

async function tsErrorOfAsync(fn: () => Promise<unknown>): Promise<{ name: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return { name: (e as Error).name, message: (e as Error).message };
  }
}

// --- Outillage crypto côté test (indépendant des deux implémentations) -------

const TEMP_HEX = "00112233445566778899aabbccddeeff";
const K0_HEX = createHash("md5").update(Buffer.alloc(0)).digest("hex");
const IV1_HEX = createHash("md5").update(Buffer.from(TEMP_HEX, "hex")).digest("hex");

function tsAesEncrypt(keyHex: string, ivHex: string, data: Buffer): Buffer {
  const c = createCipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
  return Buffer.concat([c.update(data), c.final()]);
}

function tsAesDecrypt(keyHex: string, ivHex: string, data: Buffer): Buffer {
  const d = createDecipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
  return Buffer.concat([d.update(data), d.final()]);
}

/** Exponentiation modulaire (revérification indépendante de JCE sur bloc EM fixé). */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
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
function checkRsaHeader(cipherHex: string, ctx: string): void {
  const raw = Buffer.from(cipherHex, "hex");
  expect(`${ctx} length=${raw.length}`).toBe(`${ctx} length=128`);
}

// Clé codée en dur (`pronotets` `crypto.js`, `eleve.js` en amont) : recopiée
// comme ORACLE de test. Si elle change en amont, ce test CASSE — voulu : un
// changement de clé doit être délibéré, jamais silencieux.
const RSA_N_DEC = "130337874517286041778445012253514395801341480334668979416920989365464528904618150245388048105865059387076357492684573172203245221386376405947824377827224846860699130638566643129067735803555082190977267155957271492183684665050351182476506458843580431717209261903043895605014125081521285387341454154194253026277";
const RSA_E_DEC = "65537";

// --- Serveur PRONOTE factice --------------------------------------------------

interface RecordedReq {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

interface StubBehavior {
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

function defaultBehavior(htmlAttrs: string): StubBehavior {
  return {
    htmlQueue: [htmlAttrs],
    pageCookies: [],
    paramsData: { donnees: [1, 2, 3] },
    postKeyHex: "",
    postIvHex: "",
  };
}

interface Stub {
  base: string;
  requests: RecordedReq[];
  /** Port distant vu par le serveur, un par requête (`null` si indisponible) —
   *  c'est la preuve du keep-alive : un seul port pour N requêtes (#309). */
  remotePorts: (number | null)[];
  gets: number;
  behavior: StubBehavior;
  close(): void;
}

function startStub(htmlAttrs: string): Stub {
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
      if (req.method === "GET" && url.pathname.endsWith("/eleve.html")) {
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

function behaviorKeys(stub: Stub, postKeyHex: string, postIvHex: string): void {
  stub.behavior.postKeyHex = postKeyHex;
  stub.behavior.postIvHex = postIvHex;
}

/** Normalise l'aléa documenté : `Uuid` du handshake (temp fixé ou RSA). */
function normalizeBody(body: string, keys: { fp: { keyHex: string; ivHex: string }; post: { keyHex: string; ivHex: string } }): string {
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

interface WireReq {
  method: string;
  path: string;
  contentType: string | undefined;
  cookie: string | undefined;
  userAgent: string | undefined;
  body: string;
}

/** En-têtes comparés : les utiles (le reste — `host`, `connection`, `accept`
 *  — dépend du transport, pas du protocole). */
function wireOf(
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

function tsSeededComm(stub: Stub, mobile = false): Communication {
  const comm = new Communication(`${stub.base}/pronote/eleve.html`, undefined, mobile);
  (comm.encryption as unknown as Record<string, unknown>)["aesIvTemp"] = Buffer.from(TEMP_HEX, "hex");
  return comm;
}

/** `parseHtml` est publique en JS mais privée dans le `.d.ts` : accès direct. */
function tsParseHtml(html: string): unknown {
  const probe = new Communication("http://127.0.0.1/x", undefined, false);
  return (probe as unknown as { parseHtml(h: string): unknown }).parseHtml(html);
}

async function ktSeededComm(stub: Stub, mobile = false): Promise<number> {
  const cid = (JSON.parse(await ask({ op: "commNew", site: `${stub.base}/pronote/eleve.html`, mobile })) as { cid: number }).cid;
  await ask({ op: "commSeed", cid, tempHex: TEMP_HEX });
  return cid;
}

describe("parité TS <-> Kotlin du protocole (#200/#202)", () => {
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
    // Invalides : les deux refusent (la position exacte n'est pas contractuelle).
    for (const text of ['{"a":01}', "{'a':1}", '{"a":undefined}', '{"ouvert":']) {
      const ktErr = portError(await ask({ op: "jsonEcho", text }, true));
      const tsErr = tsErrorOf(() => JSON.parse(text));
      expect(ktErr.name).toBe("JsonError");
      expect(tsErr?.name).toBe("SyntaxError");
    }
  });

  test.skipIf(skip)("crypto : MD5 et SHA-256 sur vecteurs (vide, ASCII, unicode, long)", async () => {
    for (const hex of ["", "00", "ff", "00112233445566778899aabbccddeeff"]) {
      const data = Buffer.from(hex, "hex");
      const kt = await ask({ op: "md5", dataHex: hex });
      expect(kt).toBe(JSON.stringify({ hex: md5(data).toString("hex") }));
    }
    for (const text of ["", "abc", "mot de passe", "Éléonore — 妥当性", "x".repeat(1000)]) {
      const kt = await ask({ op: "sha256", text });
      expect(kt).toBe(JSON.stringify({ hex: sha256HexUpper(text) }));
    }
  });

  test.skipIf(skip)("crypto : AES déterministe à clé/IV fixés + déchiffrement croisé", async () => {
    const plains = ["", "00", "0011223344556677", "001122334455667788", "ff".repeat(64)];
    for (const dataHex of plains) {
      const data = Buffer.from(dataHex, "hex");
      const tsEnc = new Encryption();
      tsEnc.aesKey = Buffer.from(K0_HEX, "hex");
      tsEnc.aesIv = Buffer.from(IV1_HEX, "hex");
      const tsCipher = tsEnc.aesEncrypt(data).toString("hex");
      const kt = (JSON.parse(await ask({ op: "aes", keyHex: K0_HEX, ivHex: IV1_HEX, dataHex, mode: "encrypt" })) as { hex: string }).hex;
      expect(`${dataHex} -> ${kt}`).toBe(`${dataHex} -> ${tsCipher}`);
      // Déchiffrement croisé dans les deux sens.
      const ktDec = (JSON.parse(await ask({ op: "aes", keyHex: K0_HEX, ivHex: IV1_HEX, dataHex: tsCipher, mode: "decrypt" })) as { hex: string }).hex;
      expect(ktDec).toBe(dataHex);
      expect(tsEnc.aesDecrypt(Buffer.from(kt, "hex")).toString("hex")).toBe(dataHex);
    }
    // Mauvaise clé : les deux hurlent `CryptoError` au même message.
    const badHex = tsAesEncrypt(K0_HEX, IV1_HEX, Buffer.from("0011223344556677", "hex")).toString("hex");
    const ktBad = portError(await ask({ op: "aes", keyHex: "ff".repeat(16), ivHex: IV1_HEX, dataHex: badHex, mode: "decrypt" }, true));
    const tsEnc = new Encryption();
    tsEnc.aesKey = Buffer.from("ff".repeat(16), "hex");
    tsEnc.aesIv = Buffer.from(IV1_HEX, "hex");
    const tsBad = tsErrorOf(() => tsEnc.aesDecrypt(Buffer.from(badHex, "hex")));
    expect(tsBad?.name).toBe("CryptoError");
    expect(ktBad).toEqual({ name: "CryptoError", message: tsBad?.message ?? "" });
  });

  test.skipIf(skip)("crypto : défauts (md5(vide), IV zéros) + IV dérivé du temporaire", async () => {
    const kt = await ask({ op: "aesDefaults", dataHex: "00112233", mode: "encrypt" });
    const tsEnc = new Encryption();
    expect(kt).toBe(JSON.stringify({ hex: tsEnc.aesEncrypt(Buffer.from("00112233", "hex")).toString("hex") }));
    const ktIv = await ask({ op: "aesSetIvNull", tempHex: TEMP_HEX });
    const tsEnc2 = new Encryption();
    tsEnc2.aesIvTemp = Buffer.from(TEMP_HEX, "hex");
    tsEnc2.aesSetIv();
    expect(ktIv).toBe(JSON.stringify({ iv: tsEnc2.aesIv.toString("hex") }));
    expect(JSON.parse(ktIv)).toEqual({ iv: IV1_HEX });
  });

  test.skipIf(skip)("crypto : RSA-1024 PKCS#1 v1.5 sous la clé codée en dur (en-tête + constantes)", async () => {
    // Les constantes arrivent intactes des deux côtés (bourrage aléatoire oblige).
    const ktKey = JSON.parse(await ask({ op: "rsaKey" })) as { n: string; e: string };
    expect(ktKey).toEqual({ n: RSA_N_DEC, e: RSA_E_DEC });
    // Exponentiation revérifiée indépendamment sur un bloc EM déterministe.
    const data = Buffer.from("00112233", "hex");
    const em = Buffer.concat([Buffer.from([0x00, 0x02]), Buffer.alloc(128 - 3 - data.length, 0xff), Buffer.from([0x00]), data]);
    const expected = modPow(BigInt(`0x${em.toString("hex")}`), BigInt(RSA_E_DEC), BigInt(RSA_N_DEC));
    const ktRaw = (JSON.parse(await ask({ op: "rsaNoPad", emHex: em.toString("hex") })) as { hex: string }).hex;
    expect(BigInt(`0x${ktRaw}`)).toBe(expected);
    for (const dataHex of ["00", "00112233", "ff".repeat(32)]) {
      const ktCipher = (JSON.parse(await ask({ op: "rsa", dataHex })) as { hex: string }).hex;
      checkRsaHeader(ktCipher, `port ${dataHex}`);
      // La référence passe le même contrôle (sanity : le contrôle contrôle).
      checkRsaHeader(new Encryption().rsaEncrypt(Buffer.from(dataHex, "hex")).toString("hex"), `ref ${dataHex}`);
    }
  });

  test.skipIf(skip)("pures : enleverAlea, enBytes, prepareOnglets", async () => {
    for (const text of ["", "a", "aXbYcZ", "h\u00e9llo", "abcdefg"]) {
      expect(await ask({ op: "enleverAlea", text })).toBe(JSON.stringify({ value: enleverAlea(text) }));
    }
    for (const text of ["", "72,105", "300", "abc", "12abc", "-1", " 7 , 8 ", "1,2,3,4,5"]) {
      expect(await ask({ op: "enBytes", text })).toBe(JSON.stringify({ hex: enBytes(text).toString("hex") }));
    }
    const ongletCases: unknown[] = [7, [1, [2, 3], { a: 4, b: [5] }], "texte", null, [], [{ x: 1 }, "ignoré", true, null, 9]];
    for (const value of ongletCases) {
      expect(await ask({ op: "prepareOnglets", value })).toBe(canonTs({ value: prepareOnglets(value as never) }));
    }
  });

  test.skipIf(skip)("parseHtml : attributs, IP banni, page inattendue, `h` manquant", async () => {
    const valid = `<html><body onload="Start({h: '123456', a: 'abcdef', CrA: '1', CoA: '0', http: ''})"></body></html>`;
    await expectKt({ op: "parseHtml", html: valid }, { ok: true, attrs: tsParseHtml(valid) }, "parseHtml");
    // Espaces et guillemets doubles : même lecture.
    const spaced = `Start({ h : "42" , a : "z" })`;
    await expectKt({ op: "parseHtml", html: spaced }, { ok: true, attrs: tsParseHtml(spaced) }, "parseHtml-espaces");
    // Refus : IP, page sans Start, `h` absent — les deux jettent (classes non
    // contractuelles ici : seul le contrôle compte, `initialise` réessaie).
    for (const html of ["IP bannie 1.2.3.4", "<html></html>", "Start({a: 'x'})"]) {
      const kt = JSON.parse(await ask({ op: "parseHtml", html }, true)) as { ok: boolean };
      expect(`${html} -> ${kt.ok}`).toBe(`${html} -> false`);
      expect(tsErrorOf(() => tsParseHtml(html)) !== null).toBe(true);
    }
  });

  test.skipIf(skip)("cookies : jar direct contre tough-cookie (portée, écrasement, expiration)", async () => {
    const tsJar = new CookieJar();
    const ktSid = (JSON.parse(await ask({ op: "cookieNew" })) as { sid: number }).sid;
    const script: Array<["set", string, string] | ["get", string]> = [
      ["set", "a=1; Path=/", "http://127.0.0.1/"],
      ["get", "http://127.0.0.1/"],
      ["set", "b=2; Path=/sub; Max-Age=10000", "http://127.0.0.1/sub/"],
      ["get", "http://127.0.0.1/sub/page"],
      ["get", "http://127.0.0.1/other"],
      ["set", "a=9; Path=/", "http://127.0.0.1/"],
      ["get", "http://127.0.0.1/"],
      ["set", "dead=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT", "http://127.0.0.1/"],
      ["get", "http://127.0.0.1/"],
      ["set", "sec=s; Path=/; Secure", "http://127.0.0.1/"],
      ["get", "http://127.0.0.1/"],
      // `Domain=` IP-littéral : tough-cookie refuse (« public suffix »), le port
      // accepte si l'hôte correspond (CookieJar, KDoc). Aucun serveur réel
      // n'émet ça (cookies hôte-seul ou domaines publics) : pas de cas ici.
      ["set", "gone=1; Path=/; Max-Age=0", "http://127.0.0.1/"],
      ["get", "http://127.0.0.1/"],
    ];
    for (const step of script) {
      if (step[0] === "set") {
        tsJar.setCookieSync(step[1], step[2]);
        await ask({ op: "cookieSet", sid: ktSid, header: step[1], url: step[2] });
      } else {
        const ts = tsJar.getCookieStringSync(step[1]);
        const kt = (JSON.parse(await ask({ op: "cookieGet", sid: ktSid, url: step[1] })) as { value: string }).value;
        expect(`GET ${step[1]} -> ${kt}`).toBe(`GET ${step[1]} -> ${ts}`);
      }
    }
  });

  test.skipIf(skip)("http : méthodes, params, redirects, erreurs — mêmes réponses", async () => {
    const stub = startStub(`h: '1', a: 'b'`);
    try {
      const ts = new HttpSession({ "X-Test": "ts" });
      const ktSid = (JSON.parse(await ask({ op: "httpNew", headers: { "X-Test": "kt" } })) as { sid: number }).sid;
      const cases: Array<{ method: string; url: string; opts?: Record<string, unknown> }> = [
        { method: "GET", url: `${stub.base}/params`, opts: { params: { q: "a b", x: "1", accents: "é" } } },
        { method: "POST", url: `${stub.base}/params`, opts: { data: { q: "a b" } } },
        { method: "GET", url: `${stub.base}/r302` },
        { method: "POST", url: `${stub.base}/post302`, opts: { json: { a: 1 } } },
        // 307 : méthode ET corps conservés (ni GET, ni perte).
        { method: "POST", url: `${stub.base}/post307`, opts: { json: { a: 2 } } },
        { method: "GET", url: `${stub.base}/status500` },
        { method: "GET", url: `${stub.base}/setCookies` },
        { method: "GET", url: `${stub.base}/echoCookies` },
      ];
      for (const c of cases) {
        const tsRes = await ts.request(c.method, c.url, c.opts as never);
        const tsGot = { status: tsRes.status, ok: tsRes.ok, url: tsRes.url, text: tsRes.text };
        const ktLine = await ask({ op: "httpReq", sid: ktSid, method: c.method, url: c.url, opts: c.opts ?? {} });
        const ktGot = JSON.parse(ktLine) as { status: number; ok: boolean; url: string; text: string };
        expect(`${c.method} ${c.url} -> ${canonTs({ status: ktGot.status, ok: ktGot.ok, url: ktGot.url, text: ktGot.text })}`).toBe(
          `${c.method} ${c.url} -> ${canonTs(tsGot)}`,
        );
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("http : N requêtes séquentielles gardent le même socket (keep-alive, #309)", async () => {
    const stub = startStub(`h: '1', a: 'b'`);
    try {
      const ktSid = (JSON.parse(await ask({ op: "httpNew" })) as { sid: number }).sid;
      const N = 3;
      const seq = await ask({ op: "httpSeq", sid: ktSid, url: `${stub.base}/final`, n: N });
      expect(JSON.parse(seq)).toEqual({ statuses: Array.from({ length: N }, () => 200) });
      // Le port distant vu par le serveur est la seule preuve externe de la
      // réutilisation du socket. Contrôle de l'observation (mesuré) : le même
      // pilote lancé avec `-Dhttp.keepAlive=false` donne N ports, donc
      // l'assertion n'est pas vide. Réserve : sur la JVM, un `disconnect()`
      // après un corps entièrement consommé est DÉJÀ sans effet sur ce cache
      // (`KeepAliveCache`) — c'est Android/OkHttp qui ferme le socket pour de
      // bon, d'où #309 ; le harnais prouve la propriété, pas l'appel retiré.
      expect(stub.remotePorts.length).toBe(N);
      for (const port of stub.remotePorts) expect(port).toBeGreaterThan(0);
      expect(new Set(stub.remotePorts).size).toBe(1);
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil S1 : handshake + POST en clair, octet-identique (aléa fixé)", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', `);
    try {
      const tsComm = tsSeededComm(stub);
      const tsInit = await tsComm.initialise("ident-test");
      const tsPost = await tsComm.post("TestEcho", { data: { bonjour: "monde", n: 3 } });
      const tsState = { n: tsComm.requestNumber, enc: tsComm.encryptRequests, comp: tsComm.compressRequests };
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      const initLine = await ask({ op: "commInit", cid, identifier: "ident-test" });
      const ktPost = await ask({ op: "commPost", cid, function: "TestEcho", data: { data: { bonjour: "monde", n: 3 } } });
      const stateLine = await ask({ op: "commState", cid });
      const ktWire = [...stub.requests];

      expect(`init -> ${canonTs(JSON.parse(initLine))}`).toBe(`init -> ${canonTs({ attributes: tsInit[0], response: tsInit[1] })}`);
      expect(`post -> ${canonTs(JSON.parse(ktPost))}`).toBe(`post -> ${canonTs(tsPost)}`);
      expect(`state -> ${canonTs(JSON.parse(stateLine))}`).toBe(
        `state -> ${canonTs({ requestNumber: tsState.n, encryptRequests: tsState.enc, compressRequests: tsState.comp })}`,
      );
      // Fil identique à l'octet près (Uuid = temp fixé, pas de RSA ici).
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : `CrA: '0'` chiffre aussi (vérité JS, pas booléen textuel)", async () => {
    const stub = startStub(`h: '1', a: 'b', CrA: '0'`);
    try {
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise(undefined);
      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: undefined });
      // Les deux lisent une chaîne non vide comme vraie : le fil est chiffré,
      // le stub (même lecture) déchiffre, les deux clients comprennent pareil.
      expect(tsComm.encryptRequests).toBe(true);
      const stateLine = await ask({ op: "commState", cid });
      expect(`state -> ${canonTs(JSON.parse(stateLine))}`).toBe(
        `state -> ${canonTs({ requestNumber: tsComm.requestNumber, encryptRequests: true, compressRequests: false })}`,
      );
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil S2 : chiffré (CrA) + afterAuth, octet-identique, clé dérivée", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', CrA: '1'`);
    try {
      const k1 = createHash("md5").update(Buffer.from([10, 20, 30])).digest("hex");
      behaviorKeys(stub, k1, IV1_HEX);
      stub.behavior.answer = (id, inner) => ({ bienRecu: inner });
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise("ident-test");
      // `afterAuth` pose `authKey` D'ABORD puis déchiffre `cle` SOUS ELLE (pas
      // sous la clé de session) : le test choisit les deux, fixe, des deux côtés.
      // Dérivée commune : K1 = md5([10,20,30]).
      const authKeyHex = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
      const cle = tsAesEncrypt(authKeyHex, IV1_HEX, Buffer.from("10,20,30", "utf8")).toString("hex");
      const authPayload = { dataSec: { data: { cle } } };
      await tsComm.afterAuth(authPayload as never, Buffer.from(authKeyHex, "hex"));
      const tsPost = await tsComm.post("TestEcho", { data: { secret: "chiffré" } });
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: "ident-test" });
      await ask({ op: "commAfterAuth", cid, data: authPayload, authKeyHex: "0f1e2d3c4b5a69788796a5b4c3d2e1f0" });
      const ktPost = await ask({ op: "commPost", cid, function: "TestEcho", data: { data: { secret: "chiffré" } } });
      const ktWire = [...stub.requests];

      expect(`post -> ${canonTs(JSON.parse(ktPost))}`).toBe(`post -> ${canonTs(tsPost)}`);
      // Corps déchiffrables par le test (FP : K0/zéros, posts : K1/iv1) et identiques.
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: k1, ivHex: IV1_HEX } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil S3 : compressé (CoA), contenu inflaté identique (flux non comparé)", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', CoA: '1'`);
    try {
      behaviorKeys(stub, K0_HEX, IV1_HEX);
      stub.behavior.answer = (id, inner) => ({ bienRecu: inner });
      const big = { grand: "x".repeat(500), accents: "Éléonore — 妥当性" };
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise("ident-test");
      const tsPost = await tsComm.post("TestEcho", { data: big });
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: "ident-test" });
      const ktPost = await ask({ op: "commPost", cid, function: "TestEcho", data: { data: big } });
      const ktWire = [...stub.requests];

      expect(`post -> ${canonTs(JSON.parse(ktPost))}`).toBe(`post -> ${canonTs(tsPost)}`);
      // dataSec déflaté : on compare l'inflaté, pas le flux (zlib ≠ Java).
      const inflateBody = (body: string): string => {
        if (body === "") return "";
        const env = JSON.parse(body) as { dataSec: string };
        return inflateRawSync(Buffer.from(env.dataSec, "hex")).toString("utf8");
      };
      expect(tsWire.map((r) => inflateBody(r.body))).toEqual(ktWire.map((r) => inflateBody(r.body)));
      // …mais tout le reste du fil est octet-identique.
      const stripDataSec = (reqs: RecordedReq[]) =>
        reqs.map((r) => ({ ...r, headers: {}, body: JSON.stringify({ ...JSON.parse(r.body || "{}"), dataSec: "DEFLATE" }) }));
      expect(stripDataSec(ktWire)).toEqual(stripDataSec(tsWire));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil S4 : Uuid RSA (http présent) — structure vérifiée, reste octet-identique", async () => {
    const stub = startStub(`h: '123456', a: 'abcdef', http: '1'`);
    try {
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise("ident-test");
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: "ident-test" });
      const ktWire = [...stub.requests];

      // Les deux Uuid sont des RSA-1024 v1.5 (pas les mêmes octets : bourrage).
      for (const [label, wire] of [["ref", tsWire], ["port", ktWire]] as const) {
        const post = wire.find((r) => r.method === "POST");
        const env = JSON.parse(post?.body ?? "{}") as { dataSec: { data: { Uuid: string } } };
        const uuid = Buffer.from(env.dataSec.data.Uuid, "base64");
        expect(uuid.length).toBe(128);
        checkRsaHeader(uuid.toString("hex"), `${label} uuid`);
      }
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : garde des onglets (Signature) + user-agent mobile", async () => {
    const stub = startStub(`h: '1', a: 'b', `);
    try {
      const tsComm = tsSeededComm(stub, true);
      const tsInit = await tsComm.initialise(undefined);
      tsComm.authorizedOnglets = [7];
      const tsOk = await tsComm.post("Navigation", { Signature: { onglet: 7 } });
      const tsRefused = await tsErrorOfAsync(() => tsComm.post("Navigation", { Signature: { onglet: 8 } }));
      const tsWire = [...stub.requests];
      stub.requests.length = 0;

      const cid = await ktSeededComm(stub, true);
      const init = await ask({ op: "commInit", cid, identifier: null });
      await ask({ op: "commSetOnglets", cid, onglets: [7] });
      const ktOk = await ask({ op: "commPost", cid, function: "Navigation", data: { Signature: { onglet: 7 } } });
      const ktRefused = portError(await ask({ op: "commPost", cid, function: "Navigation", data: { Signature: { onglet: 8 } } }, true));
      const ktWire = [...stub.requests];

      expect(`init -> ${canonTs(JSON.parse(init))}`).toBe(`init -> ${canonTs({ attributes: tsInit[0], response: tsInit[1] })}`);
      expect(`ok -> ${canonTs(JSON.parse(ktOk))}`).toBe(`ok -> ${canonTs(tsOk)}`);
      expect(tsRefused?.name).toBe("PronoteAPIError");
      expect(ktRefused).toEqual({ name: tsRefused?.name ?? "", message: tsRefused?.message ?? "" });
      const keys = { fp: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" }, post: { keyHex: K0_HEX, ivHex: "00000000000000000000000000000000" } };
      expect(wireOf(ktWire, keys)).toEqual(wireOf(tsWire, keys));
      for (const wire of [tsWire, ktWire]) {
        expect(wire.find((r) => r.method === "GET")?.headers["user-agent"]).toBe("iPhone");
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : erreurs serveur typées (Erreur G, HTTP 500, JSON cassé)", async () => {
    const stub = startStub(`h: '1', a: 'b', `);
    try {
      const tsComm = tsSeededComm(stub);
      await tsComm.initialise(undefined);
      const cid = await ktSeededComm(stub);
      await ask({ op: "commInit", cid, identifier: null });

      // Les aiguillages du stub sont à UN COUP : on arme avant chaque côté.
      const armG22 = () => { stub.behavior.nextEnvelope = { Erreur: { G: 22, Titre: "session morte" } }; };
      const armG99 = () => { stub.behavior.nextEnvelope = { Erreur: { G: 99, Titre: "Bizarre" } }; };
      const arm500 = () => { stub.behavior.nextPostStatus = { status: 500, body: "oops" }; };
      const armRaw = () => { stub.behavior.nextRaw = "pas du json{"; };

      // G == 22 : objet expiré.
      armG22();
      const ts22 = await tsErrorOfAsync(() => tsComm.post("X", { data: {} }));
      armG22();
      const kt22 = portError(await ask({ op: "commPost", cid, function: "X", data: { data: {} } }, true));
      expect(ts22?.name).toBe("ExpiredObject");
      expect(kt22).toEqual({ name: ts22?.name ?? "", message: ts22?.message ?? "" });

      // G inconnu : message brut `Titre` dans le texte.
      armG99();
      const ts99 = await tsErrorOfAsync(() => tsComm.post("X", { data: {} }));
      armG99();
      const kt99 = portError(await ask({ op: "commPost", cid, function: "X", data: { data: {} } }, true));
      expect(ts99?.name).toBe("PronoteAPIError");
      expect(kt99).toEqual({ name: ts99?.name ?? "", message: ts99?.message ?? "" });

      // HTTP 500 : statut dans le message.
      arm500();
      const ts500 = await tsErrorOfAsync(() => tsComm.post("X", { data: {} }));
      arm500();
      const kt500 = portError(await ask({ op: "commPost", cid, function: "X", data: { data: {} } }, true));
      expect(kt500).toEqual({ name: ts500?.name ?? "", message: ts500?.message ?? "" });

      // JSON cassé : les deux jettent (classes brutes différentes, fait assumé).
      armRaw();
      const tsBad = await tsErrorOfAsync(() => tsComm.post("Z", { data: {} }));
      armRaw();
      const ktBad = portError(await ask({ op: "commPost", cid, function: "Z", data: { data: {} } }, true));
      expect(tsBad?.name).toBe("SyntaxError");
      expect(ktBad.name).toBe("JsonError");

      // Déflate corrompu sous CoA : le même `JSONDecodeError` des deux côtés.
      const stubC = startStub(`h: '1', a: 'b', CoA: '1'`);
      try {
        const tsCo = tsSeededComm(stubC);
        await tsCo.initialise(undefined);
        const cidC = await ktSeededComm(stubC);
        await ask({ op: "commInit", cid: cidC, identifier: undefined });
        const armDeflate = () => { stubC.behavior.nextDataSec = "00ff00ff"; };
        armDeflate();
        const tsDe = await tsErrorOfAsync(() => tsCo.post("Z", { data: {} }));
        armDeflate();
        const ktDe = portError(await ask({ op: "commPost", cid: cidC, function: "Z", data: { data: {} } }, true));
        expect(tsDe?.name).toBe("PronoteAPIError");
        expect(ktDe).toEqual({ name: tsDe?.name ?? "", message: tsDe?.message ?? "" });
      } finally {
        stubC.close();
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("fil : initialise rejoue la page 3 fois (succès au 2e, échec au 3e illisible)", async () => {
    // Succès au 2e essai : le 1er HTML est illisible, le 2e est bon.
    const stub = startStub(`PAS DE START ICI`);
    try {
      stub.behavior.htmlQueue.push(`h: '7', a: 'g', `);
      const tsComm = tsSeededComm(stub);
      const tsInit = await tsComm.initialise(undefined);
      const tsGets = stub.gets;
      stub.requests.length = 0;
      stub.gets = 0;

      const stub2 = startStub(`PAS DE START ICI`);
      try {
        stub2.behavior.htmlQueue.push(`h: '7', a: 'g', `);
        const cid = await ktSeededComm(stub2);
        const init = await ask({ op: "commInit", cid, identifier: null });
        expect(stub2.gets).toBe(tsGets);
        expect(`init -> ${canonTs(JSON.parse(init))}`).toBe(`init -> ${canonTs({ attributes: tsInit[0], response: tsInit[1] })}`);
      } finally {
        stub2.close();
      }

      // 3 HTML illisibles : les deux abandonnent au même message.
      const stub3 = startStub(`TOUJOURS PAS DE START`);
      try {
        const tsErr = await tsErrorOfAsync(() => tsSeededComm(stub3).initialise(undefined));
        const cid3 = await ktSeededComm(stub3);
        const ktErr = portError(await ask({ op: "commInit", cid: cid3, identifier: null }, true));
        expect(stub3.gets).toBe(6);
        expect(ktErr).toEqual({ name: tsErr?.name ?? "", message: tsErr?.message ?? "" });
        expect(tsErr?.name).toBe("PronoteAPIError");
      } finally {
        stub3.close();
      }
    } finally {
      stub.close();
    }
  });

  test.skipIf(skip)("keepAlive : ping après 110 s d'inactivité, silence sinon", async () => {
    // Les deux jambes (TS et Kotlin) tournent EN MÊME TEMPS : le pilote ne
    // traite qu'une opération à la fois, mais une seule `ask` par phase suffit.
    // Même sémantique qu'avant (2,5 s « périmé » puis 1,2 s « frais »), durée
    // = 2,5 + 1,2 s au lieu de la somme des quatre attentes = 7,4 s → 3,7 s.
    const ktStaleP = ask({ op: "keepAlive", staleSec: 200, runMs: 2500 });
    let tsPings = 0;
    const tsStale = new KeepAlive({ communication: { lastPing: Math.floor(Date.now() / 1000) - 200 }, post: async () => { tsPings++; } } as never);
    tsStale.start();
    await new Promise((r) => setTimeout(r, 2500));
    tsStale.stop();
    const ktStale = JSON.parse(await ktStaleP) as { pings: number };
    expect(tsPings).toBeGreaterThanOrEqual(1);
    expect(ktStale.pings).toBeGreaterThanOrEqual(1);

    const ktFreshP = ask({ op: "keepAlive", staleSec: 0, runMs: 1200 });
    let tsFreshPings = 0;
    const tsFresh = new KeepAlive({ communication: { lastPing: Math.floor(Date.now() / 1000) }, post: async () => { tsFreshPings++; } } as never);
    tsFresh.start();
    await new Promise((r) => setTimeout(r, 1200));
    tsFresh.stop();
    const ktFresh = JSON.parse(await ktFreshP) as { pings: number };
    expect(tsFreshPings).toBe(0);
    expect(ktFresh.pings).toBe(0);
  }, 30000);
});

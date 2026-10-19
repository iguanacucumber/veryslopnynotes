// Parité TS <-> Kotlin du client + données (#201, #202).
//
// Le stub PRONOTE scripté parle aux DEUX implémentations (référence `pronotets`
// + port compilé) : même handshake chiffré (aléa fixé), mêmes réponses. Le test
// compare le FIL brut (octet-identique : clés, IV, compteurs déterministes) ET
// les objets rendus champ par champ (canonique, `Date` → millis, `_champs`
// omis, cycles impossibles par construction des fixtures).
//
// Règle `undefined` (rappel #200) : le pilote OMET les clés `undefined` du TS,
// garde les `null` explicites — le comparateur canonique fait pareil côté TS.
import { describe, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { join } from "node:path";
import { Client } from "pronotets";

import { ROOT, canonTs, parityToolchain, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "ClientParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

async function ask(op: unknown, allowError = false): Promise<string> {
  return link!.ask(op, { allowError });
}

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

// --- Constantes du scénario ---------------------------------------------------

const PIN = "1234";
const LOGIN = "eleve.dupont";
const JETON = "jeton-secret-xyz";
const UUID = "uuid-test-01";
const TEMP_HEX = "00112233445566778899aabbccddeeff";
const K0_HEX = createHash("md5").update(Buffer.alloc(0)).digest("hex");
const IV1_HEX = createHash("md5").update(Buffer.from(TEMP_HEX, "hex")).digest("hex");
const CLE_PLAIN = "10,20,30";
const ZEROS = "00000000000000000000000000000000";

function aes(keyHex: string, ivHex: string, data: Buffer, mode: "enc" | "dec"): Buffer {
  const c = mode === "enc" ? createCipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"))
    : createDecipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
  return Buffer.concat([c.update(data), c.final()]);
}

function qrHex(pin: string, text: string): string {
  const key = createHash("md5").update(Buffer.from(pin, "utf8")).digest();
  const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  return Buffer.concat([c.update(Buffer.from(text, "utf8")), c.final()]).toString("hex");
}

// --- Comparateurs ---------------------------------------------------------------

/** `Date` → millis, `_clés` et `undefined` omis — AVANT `stringify`
 * (`toJSON` s'appliquerait d'abord et masquerait les `Date` au replacer). */
function deepTs(v: unknown): unknown {
  if (v instanceof Date) return (v as Date).getTime();
  if (Array.isArray(v)) return v.map(deepTs);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith("_") || x === undefined) continue;
      out[k] = deepTs(x);
    }
    return out;
  }
  return v;
}

function tsCanon(v: unknown): string {
  return canonTs(deepTs(v));
}

// --- Stub PRONOTE scripté -------------------------------------------------------

interface RecordedPost {
  id: string;
  inner: unknown;
  raw: string;
}

interface StubScript {
  identifiantNav?: string;
  challenge?: Record<string, unknown>;
  auth?: { clePlain?: string; noCle?: boolean; actions?: string; derniere?: string; jeton?: string };
  params?: Record<string, unknown>;
  securisation?: number;
  notes?: Record<string, unknown>;
  presence?: unknown[];
  lessons?: unknown[];
  lessonContent?: unknown[];
  homework?: unknown[];
  discussions?: { etiquettes?: unknown[]; messages?: unknown[] };
  thread?: unknown[];
  threadWithMessage?: { listeBoutons?: unknown; messagePourReponse?: unknown };
  recipients3?: unknown[];
  recipients34?: unknown[];
  news?: unknown[];
  newsDetail?: unknown[];
  menus?: unknown[];
  doubleAuthResult?: boolean;
  infoCache?: unknown;
  /** Prochain POST → ce statut + corps (erreurs HTTP, en clair : l'enveloppe se parse quand même). */
  nextPostStatus?: { status: number; body: string };
  /** Prochain POST → ce corps BRUT (JSON cassé). */
  nextRaw?: string;
  /** Prochain POST → cette enveloppe JSON (erreurs `Erreur`, en clair). */
  nextEnvelope?: unknown;
}

interface Stub {
  base: string;
  posts: RecordedPost[];
  gets: number;
  script: StubScript;
  /** CoA actif : requêtes double-hex, réponses simple-hex (comme pronotets). */
  coa: boolean;
  /** Attributs HTML supplémentaires (`e`/`f` pour l'ENT). */
  htmlExtra: string;
  /** Clé de `cle` (dérivée du challenge, connue du test). */
  cleKeyHex: string;
  /** Mot de passe du compte (QR : le jeton ; ENT : `attributes.f`). */
  password: string;
  /** Clé de challenge `eKey`, apprise sur `Identification` (comme le serveur). */
  eKey: string;
  /** Temps récupérés des `Uuid` (un par handshake : le serveur fait pareil). */
  temps: string[];
  close(): void;
}

function defaultScript(): StubScript {
  return {
    identifiantNav: "ident-nav-1",
    challenge: { challenge: "ch-defi-1", alea: "alea1", modeCompLog: false, modeCompMdp: false },
    auth: { clePlain: CLE_PLAIN, actions: "[]", derniere: "12/09/2026 08:00:00", jeton: "mobile-token-abc" },
    params: {
      ressource: {
        N: "res-1", L: "Eleve Test", classeDEleve: { L: "3E2" }, Etablissement: { V: { L: "College Test" } },
        avecPhoto: true, estDelegue: true, listeClassesDelegue: { V: [{ L: "3E2" }] },
      },
      // 49 inclus : la sonde `PageInfosPerso` 2FA est autorisée, comme en réel.
      // Tous les onglets lus par les tests (la gate les exige, comme en reel) :
      // 7 nav, 8 actus, 10 menus, 16 EDT, 19 presence, 49 infos, 88/89 devoirs,
      // 131 messagerie, 198 notes. Imbriques pour exercer l'aplatissement.
      listeOnglets: [{ a: [7, 8, 10] }, { b: [16, 19, 49] }, { c: [88, 89, 131, 198] }],
    },
    securisation: 0,
  };
}

// K1 = md5(`enBytes(clePlain)`) : la clé de session dérivée, calculable par le
// test comme par le stub (le `clePlain` servi est fixe par scénario).
function k1Of(clePlain: string): string {
  return createHash("md5").update(Buffer.from(clePlain.split(",").map((x) => Number(x)))).digest("hex");
}

function startStub(): Stub {
  const stub = { gets: 0, posts: [], temps: [], coa: false, htmlExtra: "" } as unknown as Stub;
  stub.script = defaultScript();
  stub.cleKeyHex = "";
  stub.password = JETON;
  stub.eKey = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      // `mobile.eleve.html` après réécriture QR : pas de `/` devant (`mobile.eleve`
      // ne finit PAS par `/eleve.html`).
      if (req.method === "GET" && url.pathname.endsWith("eleve.html")) {
        stub.gets++;
        const flags = `h: '777', a: '99', CrA: '1'${stub.coa ? `, CoA: '1'` : ""}${stub.htmlExtra ? `, ${stub.htmlExtra}` : ""}`;
        return new Response(`<html><body onload="Start({${flags}})"></body></html>`, {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.pathname.includes("/FichiersExternes/")) {
        // Octets indexés sur le NOM (le magic AES varie par côté : IV par-côté).
        const filename = url.pathname.split("/").pop() ?? "fichier";
        return new Response(`BYTES:${filename}`);
      }
      if (url.pathname.includes("/appelfonction/")) {
        return (async () => {
          const body = await req.text();
          const s = stub.script;
          const envelope = JSON.parse(body) as { id: string; no: string; dataSec: unknown };
          const isParams = envelope.id === "FonctionParametres";
          // Déchiffrement : FP sous (K0, zéros) — le `Uuid` donne le temp, donc
          // iv1, comme au vrai serveur. Sinon la clé qui marche (K1 d'abord).
          let inner: unknown = envelope.dataSec;
          let reqKey = K0_HEX;
          let reqIv = ZEROS;
          if (typeof inner === "string") {
            let raw = Buffer.from(inner, "hex");
            if (isParams) {
              let fpDec = aes(K0_HEX, ZEROS, raw, "dec");
              if (stub.coa) fpDec = Buffer.from(inflateRawSync(fpDec).toString("utf8"), "hex");
              inner = JSON.parse(fpDec.toString("utf8"));
              const temp = Buffer.from(((inner as { data: { Uuid: string } }).data.Uuid), "base64").toString("hex");
              stub.temps.push(temp);
              reqIv = createHash("md5").update(Buffer.from(temp, "hex")).digest("hex");
            } else {
              // STRICT par phase (comme le vrai serveur : une seule clé marche) —
              // une clé inattendue = 500 bruyant, pas un repli silencieux.
              const iv1 = stub.temps.length
                ? createHash("md5").update(Buffer.from(stub.temps[stub.temps.length - 1] as string, "hex")).digest("hex")
                : IV1_HEX;
              const k1 = k1Of(stub.script.auth?.clePlain ?? CLE_PLAIN);
              // Enveloppes : FP (K0, zéros) ; Identification ET Authentification
              // (K0, iv1) — `eKey` ne chiffre que le CHAMP `challenge` et la `cle`
              // réponse, jamais l'enveloppe (le serveur ne connaît pas encore eKey
              // à ce stade : il le dérive lui-même pour vérifier `ch`) ; après-auth
              // (K1, iv1). Une autre clé = 500 bruyant.
              const want: [string, string] =
                envelope.id === "Identification" ? [K0_HEX, iv1]
                : envelope.id === "Authentification" ? [K0_HEX, iv1]
                : [k1, iv1];
              let dec = aes(want[0], want[1], raw, "dec");
              // CoA : l'AES recouvre du DEFLATE d'ASCII-HEX (double hex).
              if (stub.coa) dec = Buffer.from(inflateRawSync(dec).toString("utf8"), "hex");
              inner = JSON.parse(dec.toString("utf8"));
              reqKey = want[0];
              reqIv = want[1];
            }
          }
          if (envelope.id === "Identification") {
            const data = (inner as { data?: Record<string, unknown> }).data ?? {};
            if (data.pourENT === true) {
              // ENT : clé `md5(sha256(pass))`, sans `uname` ni `alea`.
              const mot = createHash("sha256").update(stub.password, "utf8").digest("hex").toUpperCase();
              stub.eKey = createHash("md5").update(Buffer.from(mot, "utf8")).digest("hex");
            } else {
              const uname = data.identifiant as string;
              const alea = (stub.script.challenge?.alea as string) ?? "";
              stub.eKey = ekeyOf(uname, stub.password, alea);
            }
          }
          stub.posts.push({ id: envelope.id, inner, raw: body });
          // Aiguillages à un coup (erreurs HTTP / enveloppes d'erreur).
          if (s.nextPostStatus) {
            const st = s.nextPostStatus;
            s.nextPostStatus = undefined;
            return new Response(st.body, { status: st.status });
          }
          if (s.nextRaw !== undefined) {
            const r = s.nextRaw;
            s.nextRaw = undefined;
            return new Response(r, { headers: { "Content-Type": "application/json" } });
          }
          if (s.nextEnvelope !== undefined) {
            const e = s.nextEnvelope;
            s.nextEnvelope = undefined;
            return Response.json(e);
          }
          // Réponse : FP sous (K0, iv1) — le client applique `decryptionChange`
          // AVANT de déchiffrer —, sinon sous la clé qui a déchiffré la requête.
          const resKey = isParams ? K0_HEX : reqKey;
          // Le client navigue `dataSec.data.X` : l'enveloppe utile est sous `data`.
          const answer = { data: answerFor(stub, envelope.id, inner, reqIv) };
          let answerBytes = Buffer.from(JSON.stringify(answer), "utf8");
          // CoA côté réponse : HEX(DEFLATE(JSON)) — simple hex (asymétrie réelle).
          if (stub.coa) answerBytes = Buffer.from(deflateRawSync(answerBytes, { level: 6 }).toString("hex").toUpperCase(), "hex");
          const dataSec = aes(resKey, reqIv, answerBytes, "enc").toString("hex").toUpperCase();
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

function answerFor(stub: Stub, id: string, inner: unknown, reqIv: string): unknown {
  const s = stub.script;
  const data = (inner as { data?: Record<string, unknown> }).data ?? {};
  switch (id) {
    case "FonctionParametres":
      return {
        identifiantNav: s.identifiantNav,
        General: {
          PremierLundi: { V: "07/09/2026" },
          DerniereDate: { V: "20/12/2026" },
          // Tableau NU (pas de `V` ici : `json.map` direct côté TS).
          ListePeriodes: [
            { N: "t1-p-1", L: "Trimestre 1", dateDebut: { V: "01/09/2026" }, dateFin: { V: "20/12/2026" } },
            { N: "t1-p-2", L: "Trimestre 2", dateDebut: { V: "05/01/2027" }, dateFin: { V: "28/03/2027" } },
          ],
          ListeHeuresFin: { V: [{ G: 1, L: "08h00" }, { G: 2, L: "09h00" }, { G: 3, L: "10h00" }] },
          ListeHeures: { V: [{ G: 1, L: "08h00" }, { G: 2, L: "09h00" }, { G: 3, L: "10h00" }] },
        },
      };
    case "Identification":
      return s.challenge ?? {};
    case "Authentification": {
      if (!s.auth || s.auth.noCle) return { sansCle: true };
      // Le `challenge` entrant DOIT se déchiffrer sous `eKey` vers le challenge
      // servi : sinon la clé de challenge est fausse des deux côtés (C3).
      {
        if (!stub.eKey) throw new Error("stub: eKey inconnue pour Authentification");
        const chHex = ((inner as { data: { challenge: string } }).data.challenge);
        const chPlain = aes(stub.eKey, reqIv, Buffer.from(chHex, "hex"), "dec").toString("utf8");
        const expected = ((s.challenge ?? {}) as Record<string, unknown>).challenge;
        if (chPlain !== expected) throw new Error(`stub: challenge inattendu (${chPlain} vs ${expected})`);
      }
      // Rotation : le jeton servi EST le mot de passe du login suivant
      // (`tokenLogin`) — le `eKey` du tour 2 en dépend, des deux côtés.
      if (s.auth.jeton) stub.password = s.auth.jeton;
      // `cle` chiffrée sous `eKey` (posée par `afterAuth` AVANT déchiffrement).
      const cle = aes(stub.eKey, reqIv, Buffer.from(s.auth.clePlain ?? CLE_PLAIN, "utf8"), "enc").toString("hex");
      return {
        cle,
        actionsDoubleAuth: { V: s.auth.actions ?? "[]" },
        derniereConnexion: s.auth.derniere ? { V: s.auth.derniere } : undefined,
        jetonConnexionAppliMobile: s.auth.jeton,
      };
    }
    case "ParametresUtilisateur":
      return s.params;
    case "PageInfosPerso": {
      // Sonde 2FA = `{Signature: {onglet}}` seul ; cache ClientInfo = Signature
      // AVEC `ressource`. (`data` n'existe jamais ici : Client.post sans data.)
      const sig = (inner as { Signature?: { ressource?: unknown } }).Signature;
      if (sig !== undefined && sig.ressource !== undefined) {
        return s.infoCache ?? { Informations: { adresse1: "1 rue", ville: "Ville" } };
      }
      return { securisation: { mode: s.securisation ?? 0 } };
    }
    case "DernieresNotes":
      return s.notes ?? {};
    case "PagePresence":
      return { listeAbsences: { V: s.presence ?? [] } };
    case "PageEmploiDuTemps":
      return { ListeCours: s.lessons ?? [] };
    case "PageCahierDeTexte":
      return { ListeTravauxAFaire: { V: s.homework ?? [] }, ListeCahierDeTextes: { V: s.lessonContent ?? [] } };
    case "SaisieTAFFaitEleve":
      return {};
    case "ListeMessagerie":
      return { listeEtiquettes: { V: s.discussions?.etiquettes ?? [] }, listeMessagerie: { V: s.discussions?.messages ?? [] } };
    case "ListeMessages":
      if ((data as Record<string, unknown>).message !== undefined) {
        return s.threadWithMessage ?? { listeBoutons: { V: [] } };
      }
      // Sans `message` : la réponse porte les DEUX (liste pour `messages()`,
      // `messagePourReponse`+`bouton` pour `reply()` — comme le vrai serveur,
      // que les deux lisent sans se marcher dessus).
      return {
        listeMessages: { V: s.thread ?? [] },
        messagePourReponse: { V: { N: "t2-mr-1" } },
        listeBoutons: { V: [{ N: "t2-b-1", L: "Repondre" }] },
      };
    case "SaisieMessage":
    case "SaisiePublicMessage":
      if ((data as Record<string, unknown>).message !== undefined && id === "SaisiePublicMessage") {
        return { listeDest: { V: [{ L: "Mme Dupont" }, { L: "M. Martin" }] } };
      }
      return {};
    case "ListeRessourcesPourCommunication": {
      const g = ((data as Record<string, unknown>).onglet as { G?: number })?.G;
      return { listeRessourcesPourCommunication: { V: g === 34 ? (s.recipients34 ?? []) : (s.recipients3 ?? []) } };
    }
    case "PageActualites":
      if ((data as Record<string, unknown>).actualite !== undefined) {
        return { detailsActualite: { listeQuestions: { V: s.newsDetail ?? [] } } };
      }
      return { listeModesAff: [{ listeActualites: { V: s.news ?? [] } }] };
    case "PageMenus":
      return { ListeJours: { V: s.menus ?? [] } };
    case "Navigation":
      return {};
    case "SecurisationCompteDoubleAuth": {
      const action = (data as Record<string, unknown>).action;
      if (action === 0) return { result: s.doubleAuthResult ?? true };
      return {};
    }
    default:
      return {};
  }
}

// --- Clients des deux côtés -----------------------------------------------------

async function tsLogin(stub: Stub, opts?: { skip2fa?: boolean; accountPin?: string; deviceName?: string }): Promise<InstanceType<typeof Client>> {
  const { Client: C } = await import("pronotets");
  const qr = { login: qrHex(PIN, LOGIN), jeton: qrHex(PIN, JETON), url: `${stub.base}/pronote/eleve.html` };
  return (await C.qrcodeLogin(qr as never, PIN, UUID, opts ?? {})) as InstanceType<typeof Client>;
}

async function ktLogin(stub: Stub, opts?: { skip2fa?: boolean; accountPin?: string; deviceName?: string }): Promise<number> {
  const cid = Number(JSON.parse(await ask({
    op: "clientQrcode",
    site: `${stub.base}/pronote/eleve.html`,
    loginHex: qrHex(PIN, LOGIN),
    jetonHex: qrHex(PIN, JETON),
    pin: PIN,
    uuid: UUID,
    qrUrl: `${stub.base}/pronote/eleve.html`,
    ...opts,
  })).cid);
  return cid;
}

// --- Comparaison de flux --------------------------------------------------------

// Clé de challenge : md5(uname + HEXMAJ(sha256(alea + pwd))).
function ekeyOf(uname: string, pwd: string, alea: string): string {
  const mot = createHash("sha256").update(alea + pwd, "utf8").digest("hex").toUpperCase();
  return createHash("md5").update(Buffer.from(uname + mot, "utf8")).digest("hex");
}

interface BothCtx {
  tsa: Stub;
  kta: Stub;
  tsClient: InstanceType<typeof Client>;
  ktCid: number;
  tsPosts: RecordedPost[];
  ktPosts: RecordedPost[];
}

/** Normalise un fil pour comparaison : `no` neutralisé, `Uuid`/`challenge`/
 * `codePin` neutralisés (aléa par-côté : temp, bourrage RSA, IV), `dataSec`
 * déchiffré sous clés STRICTES par phase (comme le stub). Comparé : session,
 * `id`, et tout l'intérieur déchiffré — les octets chiffrés eux-mêmes ne sont
 * PAS comparés (clés/IV par-côté), mais le stub strict les a validés avant. */
function normWire(stub: Stub, posts: RecordedPost[]): unknown[] {
  // Tous les iv1 vus (second tour `token` / `refresh` = nouveau temp) : un post
  // se déchiffre sous l'iv1 de SA poignée de main (C9).
  const ivs = (stub.temps.length ? stub.temps : [TEMP_HEX]).map((t) =>
    createHash("md5").update(Buffer.from(t as string, "hex")).digest("hex"),
  );
  const alea = (stub.script.challenge?.alea as string) ?? "alea1";
  // Dernier mot de passe connu (rotation suivie) + initial : le fil peut
  // couvrir deux logins (second tour `token`).
  const pwds = [...new Set([stub.password, JETON].filter((x): x is string => typeof x === "string"))];
  const ekeys = pwds.map((p) => ekeyOf(LOGIN, p, alea));
  // ENT : autre formule (`md5(sha256(pass))`, sans uname/alea).
  const ekeysEnt = pwds.map((p) => {
    const mot = createHash("sha256").update(p, "utf8").digest("hex").toUpperCase();
    return createHash("md5").update(Buffer.from(mot, "utf8")).digest("hex");
  });
  const k1 = k1Of(stub.script.auth?.clePlain ?? CLE_PLAIN);
  return posts.map((p) => {
    const env = JSON.parse(p.raw) as { session: unknown; id: string; no: string; dataSec: unknown };
    let inner = env.dataSec;
    if (typeof inner === "string") {
      const raw = Buffer.from(inner, "hex");
      const ekeyCands = [...ekeys, ...ekeysEnt].flatMap((e): Array<[string, string]> => ivs.map((iv) => [e, iv]));
      const postCands: Array<[string, string]> = [...ekeyCands, ...ivs.flatMap((iv): Array<[string, string]> => [[k1, iv], [K0_HEX, iv]])];
      const candidates = p.id === "FonctionParametres" ? [[K0_HEX, ZEROS]] : postCands;
      for (const [k, iv] of candidates as Array<[string, string]>) {
        try {
          inner = JSON.parse(aes(k, iv, raw, "dec").toString("utf8"));
          break;
        } catch {
          continue;
        }
      }
    }
    const data = (inner as { data?: Record<string, unknown> }).data;
    if (data !== null && typeof data === "object") {
      // Aléa documenté (voir ci-dessus). `Uuid` : longueur affirmée (24 = temp
      // brut, 172 = RSA) pour ne pas masquer un changement de branche.
      if ("Uuid" in data) {
        const u = (data as Record<string, unknown>).Uuid as string;
        if (u.length !== 24 && u.length !== 172) throw new Error(`Uuid de longueur inattendue : ${u.length}`);
        (data as Record<string, unknown>).Uuid = "TEMP";
      }
      if ("challenge" in data) (data as Record<string, unknown>).challenge = "#";
      if ("codePin" in data) (data as Record<string, unknown>).codePin = "#";
    }
    return { session: env.session, id: env.id, no: "#", dataSec: inner };
  });
}

function tsStateOf(client: InstanceType<typeof Client>): Record<string, unknown> {
  const c = client as unknown as Record<string, unknown>;
  const comm = c.communication as { authorizedOnglets: unknown };
  return {
    loggedIn: c.logged_in,
    week: c.week,
    loginMode: c.loginMode,
    username: c.username,
    password: c.password,
    uuid: c.uuid,
    clientIdentifier: c.clientIdentifier,
    periodIds: ((c.periods as Array<{ id: string }>) ?? []).map((p) => p.id),
    infoName: ((c.info as { name: string }).name),
    onglets: comm.authorizedOnglets,
  };
}

async function expectBothStates(ctx: BothCtx, label: string): Promise<void> {
  const kt = JSON.parse(await ask({ op: "clientState", cid: ctx.ktCid }));
  expect(`${label} state -> ${canonTs(kt)}`).toBe(`${label} state -> ${canonTs(tsStateOf(ctx.tsClient))}`);
}

async function expectBothWire(ctx: BothCtx, label: string): Promise<void> {
  const ts = canonTs(normWire(ctx.tsa, ctx.tsPosts));
  const kt = canonTs(normWire(ctx.kta, ctx.ktPosts));
  expect(`${label} FIL (ts vs kt):\n${kt}`).toBe(`${label} FIL (ts vs kt):\n${ts}`);
}

// --- Fixtures riches --------------------------------------------------------------

function richScript(s: StubScript): void {
  s.notes = {
    listeDevoirs: {
      V: [
        {
          N: "t2-g-1", note: { V: "14,50" }, bareme: { V: "20" }, date: { V: "12/09/2026" },
          service: { V: { N: "t2-s-maths", L: "Maths" } }, periode: { V: { N: "t1-p-1" } },
          coefficient: "2", moyenne: { V: "11" }, noteMax: { V: "18" }, noteMin: { V: "5" },
          commentaire: "Bien", estBonus: false, estFacultatif: false, estRamenerSur20: false,
        },
        {
          N: "t2-g-2", note: { V: "|1" }, bareme: { V: "20" }, date: { V: "13/09/2026" },
          service: { V: { N: "t2-s-maths", L: "Maths" } }, periode: { V: { N: "t1-p-1" } },
        },
        {
          N: "t2-g-3", note: { V: "8" }, bareme: { V: "10" }, date: { V: "14/09/2026 10:30:00" },
          service: { V: { N: "t2-s-svt", L: "SVT" } }, periode: { V: { N: "t1-p-9" } }, estBonus: true,
        },
      ],
    },
    listeServices: {
      V: [
        {
          N: "t2-s-maths", L: "Maths", moyEleve: { V: "12,5" }, baremeMoyEleve: { V: "20" },
          baremeMoyEleveParDefault: { V: "20" }, moyClasse: { V: "11" }, moyMin: { V: "4" }, moyMax: { V: "18" },
        },
        {
          N: "t2-s-eps", L: "EPS", moyEleve: { V: "|3" }, baremeMoyEleve: { V: "20" },
          moyClasse: { V: "10" }, moyMin: { V: "3" }, moyMax: { V: "17" }, couleur: "#abc",
        },
      ],
    },
    moyGenerale: { V: "13,25" },
  };
  s.presence = [
    {
      G: 13, N: "t2-a-1", dateDebut: { V: "15/09/2026 08:00:00" }, dateFin: { V: "15/09/2026 10:00:00" },
      justifie: false, NbrHeures: "2", NbrJours: 0, listeMotifs: { V: [{ L: "Malade" }] },
    },
    {
      G: 14, N: "t2-l-1", date: { V: "16/09/2026 08:05:00" }, duree: 15, justifie: true,
      justification: null, listeMotifs: { V: [] },
    },
    {
      G: 41, N: "t2-s-1", dateDemande: { V: "17/09/2026" }, horsCours: false, placeDemande: 2,
      estUneExclusion: false, travailAFaire: null, documentsTAF: { V: [] }, circonstances: "Bavardages",
      documentsCirconstances: { V: [] }, nature: { V: { L: "Avertissement" } },
      listeMotifs: { V: [{ L: "Bavardage" }] }, demandeur: { V: { L: "M. Martin" } },
      estProgrammable: true,
      programmation: { V: [{ N: "t2-sp-1", date: { V: "20/09/2026" }, placeExecution: 3, duree: 60 }] },
      duree: 120,
    },
    { G: 99, N: "t2-x-1" },
  ];
  s.lessons = [
    {
      N: "t2-l-1", estAnnule: false, Statut: "", memo: null, CouleurFond: "#fff", estSortiePedagogique: false,
      DateDuCours: { V: "21/09/2026 08:00:00" }, dispenseEleve: false,
      listeVisios: { V: [{ url: "https://visio/x" }] }, P: 1, estRetenue: false,
      cahierDeTextes: { V: { estDevoir: true } }, DateDuCoursFin: { V: "21/09/2026 09:00:00" },
      place: 1, duree: 1,
      ListeContenus: {
        V: [
          { G: 16, N: "t2-s-m", L: "Maths" }, { G: 3, L: "Mme Dupont" }, { G: 17, L: "Salle 12" },
          { G: 2, L: "Groupe A" }, { sansG: true },
        ],
      },
    },
    {
      N: "t2-l-2", estAnnule: true, DateDuCours: { V: "22/09/2026 10:00:00" }, P: 2,
      place: 2, duree: 2, ListeContenus: { V: [{ G: 3, L: "M. Martin" }] },
    },
  ];
  s.lessonContent = [
    {
      cours: { V: { N: "t2-l-1" } },
      listeContenus: {
        V: [
          {
            L: "Fractions", descriptif: { V: "<p>Exercices</p>" }, categorie: { V: { L: "Cours" } },
            ListePieceJointe: { V: [{ L: "exos.pdf", N: "t2-f-1", G: 1 }] },
          },
        ],
      },
    },
  ];
  s.homework = [
    {
      N: "t2-h-1", descriptif: { V: "<b>Lire</b> p.5" }, TAFFait: false,
      Matiere: { V: { N: "t2-s-fr", L: "Francais" } }, PourLe: { V: "25/09/2026" }, CouleurFond: "#eee",
      ListePieceJointe: { V: [{ L: "texte.pdf", N: "t2-f-2", G: 1 }] },
    },
    {
      N: "t2-h-2", descriptif: { V: "Fini" }, TAFFait: true,
      Matiere: { V: { N: "t2-s-fr", L: "Francais" } }, PourLe: { V: "01/01/2020" }, CouleurFond: "#eee",
      ListePieceJointe: { V: [] },
    },
  ];
  s.discussions = {
    etiquettes: [{ N: "t2-e1", G: 4 }, { N: "t2-e2", G: 5 }, { N: "t2-e3", G: 9 }],
    messages: [
      {
        N: "t2-d-1", objet: "Absence du 12/09", initiateur: "Vie scolaire",
        messagePourParticipants: { V: { N: "t2-pm-1" } }, nbNonLus: 2, ferme: false,
        listeEtiquettes: { V: [{ N: "t2-e1" }, { N: "t2-e9" }] },
        listePossessionsMessages: { V: [{ N: "t2-poss-1" }] }, estUneDiscussion: true, profondeur: 0,
      },
      { N: "t2-d-2", objet: "Filtre", estUneDiscussion: false, profondeur: 0 },
      { N: "t2-d-3", objet: "Filtre", estUneDiscussion: true, profondeur: 1 },
    ],
  };
  s.thread = [
    {
      possessionMessage: { V: { N: "t2-poss-1" } }, N: "t2-m-1", emetteur: false, public_gauche: "Mme Dupont",
      lu: true, date: { V: "12/09/2026 09:00:00" }, estHTML: true, contenu: { V: "<p>Bonjour</p>" },
      messageSource: { V: { N: "t2-m-0" } },
    },
    {
      possessionMessage: { V: { N: "t2-poss-1" } }, N: "t2-m-2", emetteur: true,
      lu: false, date: { V: "12/09/2026 10:00:00" }, estHTML: false, contenu: "vu, merci",
      messageSource: { V: { N: "t2-m-1" } },
    },
  ];
  s.threadWithMessage = {
    listeBoutons: { V: [{ N: "t2-b-1", L: "Repondre" }] },
    messagePourReponse: { V: { N: "t2-mr-1" } },
  };
  s.recipients3 = [
    { G: 3, N: "t2-r-1", L: "Mme Dupont", email: "d@e.fr", listeRessources: { V: [{ L: "Maths" }] }, avecDiscussion: true },
  ];
  s.recipients34 = [
    { G: 7, N: "t2-r-2", L: "Secretariat", fonction: { V: { L: "Accueil" } }, avecDiscussion: false },
  ];
  s.news = [
    {
      N: "t2-n-1", L: "Conseil", auteur: "Direction", lue: false, dateCreation: { V: "10/09/2026 08:00:00" },
      dateDebut: { V: "11/09/2026" }, dateFin: { V: "30/09/2026" }, nature: { V: { L: "Info" } },
      estSondage: false, estModele: false, estModelePartage: false, reponseAnonyme: false,
    },
    {
      N: "t2-n-2", auteur: "Direction", lue: true, dateCreation: { V: "10/09/2026 08:00:00" },
      nature: { V: { L: "Info" } }, estSondage: true, reponseAnonyme: false,
    },
  ];
  s.newsDetail = [
    {
      texte: { V: "<p>Ordre du jour</p>" },
      listePiecesJointes: { V: [{ L: "odj.pdf", N: "t2-f-3", G: 1 }] },
    },
  ];
  s.menus = [
    {
      Date: { V: "21/09/2026" },
      ListeRepas: {
        V: [
          {
            N: "t2-m-1", L: "Dejeuner", G: 0,
            ListePlats: {
              V: [
                {
                  G: 1,
                  ListeAliments: {
                    V: [{ N: "t2-p-1", L: "Poulet", listeLabelsAlimentaires: { V: [{ N: "t2-l-1", L: "Fait maison", couleur: "#fff" }] } }],
                  },
                },
                { G: 5, ListeAliments: { V: [] } },
              ],
            },
          },
          { N: "t2-m-2", L: "Diner", G: 1, ListePlats: { V: [] } },
          // `G: null` : `Number(null) == 0` donc déjeuner, clé `"null"` sans slot.
          { N: "t2-m-3", L: "Gouter", G: null, ListePlats: { V: [] } },
        ],
      },
    },
  ];
}

// --- Magie AES des pièces jointes -------------------------------------------------
// Le magic = AES(K1, iv1_par_côté, payload) : jamais octet-identique entre côtés
// (IV aléatoires). On prouve l'égalité autrement : déchiffrement par-côté vers
// le même payload, + URLs normalisées pour le reste.

function normMagicUrl(url: string): string {
  // Magic (IV par-côté) + port (stubs séparés) normalisés : le reste est exact.
  return url
    .replace(/\/FichiersExternes\/[0-9A-Fa-f]+\//, "/FichiersExternes/MAGIC/")
    .replace(/:\d+\//, ":PORT/");
}

function checkMagic(stub: Stub, url: string, fileId: string): void {
  // eslint-disable-next-line no-console
  const m = url.match(/\/FichiersExternes\/([0-9A-Fa-f]+)\//);
  if (!m) throw new Error(`pas de magic dans ${url}`);
  const raw = Buffer.from(m[1] as string, "hex");
  // Le magic porte DEUX bourrages (manuel PUIS AES) : on retire le manuel
  // après déchiffrement, comme le ferait le serveur.
  const unpadManual = (b: Buffer): Buffer => {
    const n = b[b.length - 1] as number;
    return n >= 1 && n <= 16 ? b.subarray(0, b.length - n) : b;
  };
  // STRICT : (K1, iv1 courant) uniquement. Un magic sous une autre clé/IV
  // (K0, zéros, vieux temp) échoue bruyamment au lieu de passer par repli (C6).
  const temps = stub.temps as string[];
  const iv1 = createHash("md5").update(Buffer.from(temps[temps.length - 1] as string, "hex")).digest("hex");
  const k1 = k1Of(stub.script.auth?.clePlain ?? CLE_PLAIN);
  const payload = JSON.parse(unpadManual(aes(k1, iv1, raw, "dec")).toString("utf8"));
  expect(payload).toEqual({ N: fileId, Actif: true });
}

// --- Projections TS (cycles coupés comme le pilote) --------------------------------

function flatGrade(g: Record<string, unknown>): Record<string, unknown> {
  const { period, ...rest } = g;
  return { ...rest, periodId: (period as { id?: string } | undefined)?.id };
}

function flatMessage(m: Record<string, unknown>): Record<string, unknown> {
  // `replyingTo` -> id (cycles coupés comme le pilote) ; `date` GARDÉE des deux
  // côtés (le pilote la rend : une régression `dateParse` casserait ici, C7).
  const { replyingTo, ...rest } = m;
  return { ...rest, replyingTo: ((replyingTo as { id?: string } | null)?.id ?? null) as unknown };
}

describe("parité TS <-> Kotlin du client + données (#201/#202)", () => {
  test.skipIf(skip)("resolveur : dates FR, 6 + 3 branches, refus identiques", async () => {
    const dates: Array<[string, string]> = [
      ["dateParse", "12/09/2026"],
      ["dateParse", "12/09/26"],
      ["dateParse", "12/09/2026 08:00:00"],
      ["dateParse", "12/09/26 08h00"],
      ["datetimeParse", "12/09/2026"],
      ["datetimeParse", "12/09/2026 08:00:00"],
      ["datetimeParse", "12/09/26 08h00"],
    ];
    const { Util } = await import("../../node_modules/pronotets/dist/resolver.js");
    for (const [kind, text] of dates) {
      const kt = JSON.parse(await ask({ op: kind, text })) as { millis: number };
      const ts = (Util[kind as "dateParse"] as (s: string) => Date)(text).getTime();
      expect(`${kind} ${text} -> ${kt.millis}`).toBe(`${kind} ${text} -> ${ts}`);
    }
    // Débordements : cascade calendaire comme `new Date` (jamais d'erreur).
    for (const [kind, text] of [["dateParse", "32/09/2026"], ["dateParse", "12/13/2026"], ["dateParse", "12/09/2026 25:00:00"]] as Array<[string, string]>) {
      const kt = JSON.parse(await ask({ op: kind, text })) as { millis: number };
      const ts = (Util[kind as "dateParse"] as (s: string) => Date)(text).getTime();
      expect(`${kind} ${text} -> ${kt.millis}`).toBe(`${kind} ${text} -> ${ts}`);
    }
    // Refus : JJ/MM et HHMM en datetimeParse, formats absurdes partout.
    const bad: Array<[string, string]> = [
      ["datetimeParse", "12/09"],
      ["datetimeParse", "0800"],
      ["dateParse", "2026-09-12"],
      ["dateParse", "8/9/2026"],
    ];
    for (const [kind, text] of bad) {
      const kt = portError(await ask({ op: kind, text }, true));
      let tsName = "";
      try {
        (Util[kind as "dateParse"] as (s: string) => Date)(text);
      } catch (e) {
        tsName = (e as Error).name;
      }
      // `JJ/MM` en dateParse dépend de l'année courante : les deux acceptent.
      expect(`${kind} ${text} -> ${kt.name}`).toBe(`${kind} ${text} -> DateParsingError`);
      expect(tsName).toBe("DateParsingError");
    }
  });

  test.skipIf(skip)("resolveur : notes codées, HTML, tranches, nombres", async () => {
    const { Util } = await import("../../node_modules/pronotets/dist/resolver.js");
    for (const text of ["14,50", "12.5", "|1", "|8", "|9", "|", "note"]) {
      const kt = JSON.parse(await ask({ op: "gradeParse", text }));
      expect(`gradeParse ${text} -> ${canonTs(kt)}`).toBe(`gradeParse ${text} -> ${canonTs({ value: Util.gradeParse(text) ?? null })}`);
    }
    for (const text of ["<p>Bonjour&nbsp;&amp;</p>", "a&#x41;b&#66;c&douteux;", ""]) {
      expect(await ask({ op: "htmlParse", text })).toBe(JSON.stringify({ value: Util.htmlParse(text) }));
    }
    const heures = [{ G: 1, L: "08h00" }, { G: 2, L: "09h00" }, { G: 3, L: "10h00" }];
    for (const place of [1, 3, 5]) {
      const kt = await ask({ op: "place2time", heures, place });
      const ts = Util.place2time(heures as never, place);
      expect(`place ${place} -> ${kt}`).toBe(`place ${place} -> ${canonTs(ts)}`);
    }
    // Tranche illisible : les deux jettent (classes brutes différentes, fait assumé).
    for (const bad of [[{ G: 1, L: "8h00" }], null]) {
      const kt = portError(await ask({ op: "place2time", heures: bad, place: 1 }, true));
      expect(kt.name).toBe("IllegalStateException");
      let threw = false;
      try {
        Util.place2time(bad as never, 1);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }
    for (const value of ["", " 12 ", "0x10", "0b101", "0o17", "Infinity", "-Infinity", "abc", "12abc", 12.5, true, null]) {
      const kt = JSON.parse(await ask({ op: "numOf", value })) as { value: number | null };
      const ts = (await import("../../node_modules/pronotets/dist/resolver.js") as unknown as { num: (v: unknown) => number }).num(value);
      expect(`num ${JSON.stringify(value)} -> ${canonTs(kt)}`).toBe(`num ${JSON.stringify(value)} -> ${canonTs({ value: ts })}`);
    }
    for (const value of ["", "x", 0, 1, null, false, true]) {
      const kt = JSON.parse(await ask({ op: "boolOf", value })) as { value: boolean };
      const { bool } = await import("../../node_modules/pronotets/dist/resolver.js");
      expect(`bool ${JSON.stringify(value)} -> ${canonTs(kt)}`).toBe(`bool ${JSON.stringify(value)} -> ${canonTs({ value: bool(value) })}`);
    }
  });

  test.skipIf(skip)("auth : QR heureux, rotation du jeton, état identique", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      const tsClient = await tsLogin(tsa);
      const tsPosts = [...tsa.posts];
      tsa.posts.length = 0;
      const ktCid = await ktLogin(kta);
      const ktPosts = [...kta.posts];
      kta.posts.length = 0;
      await expectBothStates({ tsa, kta, tsClient, ktCid, tsPosts, ktPosts }, "auth");
      await expectBothWire({ tsa, kta, tsClient, ktCid, tsPosts, ktPosts }, "auth");
      // Rotation : le mot de passe est le jeton mobile, plus le QR.
      expect(tsClient.password).toBe("mobile-token-abc");
      const ktState = JSON.parse(await ask({ op: "clientState", cid: ktCid })) as { password: string };
      expect(ktState.password).toBe("mobile-token-abc");
      // `exportCredentials` suit la rotation des deux côtés (ports normalisés :
      // deux stubs = deux ports, le reste de l'URL est identique).
      const normUrl = (u: string): string => u.replace(/:\d+\/pronote/, ":PORT/pronote");
      const ktCreds = JSON.parse(await ask({ op: "exportCreds", cid: ktCid })) as Record<string, unknown>;
      const tsCreds = tsClient.exportCredentials() as unknown as Record<string, unknown>;
      expect(canonTs({ ...ktCreds, pronoteUrl: normUrl(ktCreds.pronoteUrl as string) })).toBe(
        canonTs({ ...tsCreds, pronoteUrl: normUrl(tsCreds.pronoteUrl as string) }),
      );
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("QR : URL réécrite — hôte underscore, IDN, port, chemin vide (parité TS)", async () => {
    // Référence TS : la transformation de `new URL()` faite par `qrcodeLogin`.
    const tsRewrite = (raw: string): string => {
      const url = new URL(raw);
      const parts = url.pathname.split("/");
      if (!parts[parts.length - 1].startsWith("mobile.")) parts[parts.length - 1] = "mobile." + parts[parts.length - 1];
      url.pathname = parts.join("/");
      url.search = "?fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true";
      url.hash = "";
      return url.toString();
    };
    // Hôtes « non serveur » : `URI.getHost()` y vaut NULL, le port Kotlin les
    // REFUSAIT tous (appairage impossible sur ces établissements, #402).
    const urls = [
      "https://lycee_jean_moulin.example/pronote/eleve.html",
      "https://ecole_avec_accents.example/pronote/eleve.html",
      "https://école.example/pronote/eleve.html",
      "https://LYCee_EXAMPLE.example/pronote/eleve.html",
      "https://ecole.example:8443/pronote/eleve.html",
      "https://ecole.example:443/pronote/eleve.html",
      "https://ecole.example",
      "https://ecole.example/",
      "https://eleve@ecole.example/pronote/eleve.html",
      "https://ecole.example/pronote/eleve.html#ancre",
      "https://[::1]:/pronote/eleve.html",
    ];
    for (const raw of urls) {
      const kt = JSON.parse(await ask({ op: "rewriteQrUrl", url: raw })) as { url: string };
      expect(`rewriteQrUrl ${raw} -> ${kt.url}`).toBe(`rewriteQrUrl ${raw} -> ${tsRewrite(raw)}`);
      // L'hôte est repris tel quel par l'appelant : jamais de « double slash ».
      expect(kt.url.replace(/^https?:\/\//, "")).not.toContain("//");
    }
    // Cas d'école : l'hôte underscore est celui attendu, pas un refus.
    const kt = JSON.parse(await ask({ op: "rewriteQrUrl", url: "https://lycee_jean_moulin.example/pronote/eleve.html" })) as { url: string };
    expect(kt.url).toBe(
      "https://lycee_jean_moulin.example/pronote/mobile.eleve.html" +
        "?fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true",
    );
    // IDN : punycode, comme `new URL()`.
    const idn = JSON.parse(await ask({ op: "rewriteQrUrl", url: "https://école.example/pronote/eleve.html" })) as { url: string };
    expect(idn.url).toBe(tsRewrite("https://école.example/pronote/eleve.html"));
    // Hôte IDN : l'URL reste utilisable telle quelle (ASCII, un seul `/`).
    expect(idn.url.startsWith("https://xn--cole-9oa.example/pronote/mobile.eleve.html?")).toBe(true);
    // Refus : autorité sans hôte ou port illisible (le TS jette un TypeError,
    // le port un IllegalArgumentException — même refus des deux côtés).
    for (const raw of ["https://:8443/x", "https://ecole.example:abc/x", "https://ecole.example:8443:90/x", "https://ecole.example:99999/x"]) {
      const bad = portError(await ask({ op: "rewriteQrUrl", url: raw }, true));
      expect(`rewriteQrUrl ${raw} -> ${bad.name}`).toBe(`rewriteQrUrl ${raw} -> IllegalArgumentException`);
      expect(() => new URL(raw)).toThrow();
    }
  });

  test.skipIf(skip)("auth : sécurisation active => second tour `token`", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.script.securisation = 1;
      kta.script.securisation = 1;
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      // Deux handshakes (FP) de chaque côté, mode final `token`.
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      // Temp FRAIS au second tour (pas de rejeu d'aléa), des deux côtés (C10).
      for (const stub of [tsa, kta]) {
        const uuids = stub.posts
          .filter((p) => p.id === "FonctionParametres")
          .map((p) => ((p.inner as { data: { Uuid: string } }).data.Uuid));
        expect(new Set(uuids).size).toBe(2);
        for (const u of uuids) expect(Buffer.from(u, "base64").length).toBe(16);
      }
      expect(tsClient.loginMode).toBe("token");
      const ktState = JSON.parse(await ask({ op: "clientState", cid: ktCid })) as { loginMode: string };
      expect(ktState.loginMode).toBe("token");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("auth : refus typés (PIN faux, hex pourri, sans cle, 2FA)", async () => {
    // PIN faux : déchiffrement QR impossible.
    const badPinTs = await (async () => {
      try {
        const { Client: C } = await import("pronotets");
        await C.qrcodeLogin({ login: qrHex(PIN, LOGIN), jeton: qrHex(PIN, JETON), url: "http://127.0.0.1/x" } as never, "9999", UUID);
        return null;
      } catch (e) {
        return { name: (e as Error).name, message: (e as Error).message };
      }
    })();
    const badPinKt = portError(await ask({
      op: "clientQrcode", site: "http://127.0.0.1/x", loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
      pin: "9999", uuid: UUID, qrUrl: "http://127.0.0.1/x",
    }, true));
    expect(badPinKt).toEqual({ name: badPinTs?.name ?? "", message: badPinTs?.message ?? "" });
    expect(badPinTs?.name).toBe("QRCodeDecryptError");

    // Hex pourri : même refus (le TS tronque en silence puis échoue au déchiffrement).
    const badHexKt = portError(await ask({
      op: "clientQrcode", site: "http://127.0.0.1/x", loginHex: "zz", jetonHex: "zz",
      pin: PIN, uuid: UUID, qrUrl: "http://127.0.0.1/x",
    }, true));
    expect(badHexKt.name).toBe("QRCodeDecryptError");

    // Sans `cle` + `skip2fa` : login `false` propre, pas de sonde (donc pas de gate).
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.script.auth = { noCle: true };
      kta.script.auth = { noCle: true };
      const tsClient = await tsLogin(tsa, { skip2fa: true });
      const ktLoginRes = JSON.parse(await ask({
        op: "clientQrcode", site: `${kta.base}/pronote/eleve.html`, loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
        pin: PIN, uuid: UUID, qrUrl: `${kta.base}/pronote/eleve.html`, skip2fa: true,
      })) as { cid: number; loggedIn: boolean };
      expect(tsClient.logged_in).toBe(false);
      expect(ktLoginRes.loggedIn).toBe(false);
      // Aucune sonde `PageInfosPerso` : le login raté ne poste rien de plus.
      expect(tsa.posts.some((p) => p.id === "PageInfosPerso")).toBe(false);
      expect(kta.posts.some((p) => p.id === "PageInfosPerso")).toBe(false);
    } finally {
      tsa.close();
      kta.close();
    }

    // Sans `cle` SANS `skip2fa` : la sonde tourne quand même (`logged_in` ignoré,
    // upstream), la gate refuse (`onglets` vides), `refresh` rejoue, ça rejette
    // pareil des deux côtés. Bizarrerie fidèlement portée, pas corrigée ici.
    const tsa3 = startStub();
    const kta3 = startStub();
    try {
      tsa3.script.auth = { noCle: true };
      kta3.script.auth = { noCle: true };
      const tsErr = await (async () => {
        try {
          await tsLogin(tsa3);
          return null;
        } catch (e) {
          return { name: (e as Error).name, message: (e as Error).message };
        }
      })();
      const ktErr = portError(await ask({
        op: "clientQrcode", site: `${kta3.base}/pronote/eleve.html`, loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
        pin: PIN, uuid: UUID, qrUrl: `${kta3.base}/pronote/eleve.html`,
      }, true));
      expect(tsErr?.name).toBe("PronoteAPIError");
      expect(ktErr).toEqual({ name: tsErr?.name ?? "", message: tsErr?.message ?? "" });
    } finally {
      tsa3.close();
      kta3.close();
    }

    // 2FA exigée sans PIN : `MFAError` des deux côtés.
    const tsa2 = startStub();
    const kta2 = startStub();
    try {
      tsa2.script.auth = { actions: "[3]", derniere: "12/09/2026 08:00:00", jeton: "tok" };
      kta2.script.auth = { actions: "[3]", derniere: "12/09/2026 08:00:00", jeton: "tok" };
      const tsErr = await (async () => {
        try {
          await tsLogin(tsa2);
          return null;
        } catch (e) {
          return { name: (e as Error).name, message: (e as Error).message };
        }
      })();
      const ktErr = portError(await ask({
        op: "clientQrcode", site: `${kta2.base}/pronote/eleve.html`, loginHex: qrHex(PIN, LOGIN), jetonHex: qrHex(PIN, JETON),
        pin: PIN, uuid: UUID, qrUrl: `${kta2.base}/pronote/eleve.html`,
      }, true));
      expect(tsErr?.name).toBe("MFAError");
      expect(ktErr).toEqual({ name: tsErr?.name ?? "", message: tsErr?.message ?? "" });
    } finally {
      tsa2.close();
      kta2.close();
    }
  });

  test.skipIf(skip)("post : `G=10` rejoue handshake + retry, `G=22` remonte sans rejeu", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const arm = (s: typeof tsa) => {
        s.script.nextEnvelope = { Erreur: { G: 10, Titre: "expire" } };
      };
      arm(tsa);
      const tsRes = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      arm(kta);
      const ktRes = await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } });
      // Un second handshake (FP) a eu lieu des deux côtés, puis le retry a abouti.
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      for (const stub of [tsa, kta]) {
        const uuids = stub.posts
          .filter((p) => p.id === "FonctionParametres")
          .map((p) => ((p.inner as { data: { Uuid: string } }).data.Uuid));
        expect(new Set(uuids).size).toBe(2);
      }
      expect(canonTs(JSON.parse(ktRes))).toBe(tsCanon(tsRes));

      // `G=22` : pas de rejeu, `ExpiredObject` direct.
      tsa.script.nextEnvelope = { Erreur: { G: 22, Titre: "mort" } };
      kta.script.nextEnvelope = { Erreur: { G: 22, Titre: "mort" } };
      let tsName = "";
      let tsMsg = "";
      try {
        await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      } catch (e) {
        tsName = (e as Error).name;
        tsMsg = (e as Error).message;
      }
      const ktErr = portError(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }, true));
      expect(tsName).toBe("ExpiredObject");
      expect(ktErr).toEqual({ name: tsName, message: tsMsg });
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(2);

      // `G` inconnu UNE fois : `refresh` + retry qui aboutit — aucune erreur ne
      // remonte (le retry est brut, son résultat fait foi). Refresh prouvé par
      // les handshakes, succès identiques ensuite.
      tsa.script.nextEnvelope = { Erreur: { G: 99, Titre: "Bizarre" } };
      kta.script.nextEnvelope = { Erreur: { G: 99, Titre: "Bizarre" } };
      const ts99 = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      const kt99 = JSON.parse(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }));
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(3);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(3);
      expect(canonTs(kt99)).toBe(tsCanon(ts99));

      // HTTP 500 UNE fois : même scénario (refresh + retry + succès identique).
      tsa.script.nextPostStatus = { status: 500, body: "oops" };
      kta.script.nextPostStatus = { status: 500, body: "oops" };
      const ts500 = await tsClient.post("TestEcho", 7, { data: { a: 1 } });
      const kt500 = JSON.parse(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }));
      expect(tsa.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(4);
      expect(kta.posts.filter((p) => p.id === "FonctionParametres")).toHaveLength(4);
      expect(canonTs(kt500)).toBe(tsCanon(ts500));

      // JSON cassé : les deux jettent (classes brutes différentes, fait assumé).
      tsa.script.nextRaw = "pas du json{";
      kta.script.nextRaw = "pas du json{";
      const tsBad = await tsErrorOfAsync(() => tsClient.post("TestEcho", 7, { data: { a: 1 } }));
      const ktBad = portError(await ask({ op: "clientPost", cid: ktCid, function: "TestEcho", onglet: 7, data: { data: { a: 1 } } }, true));
      expect(tsBad?.name).toBe("SyntaxError");
      expect(ktBad.name).toBe("JsonError");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("trimestre : notes, moyennes, bulletin, vie scolaire", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.script.notes = tsa.script.notes ?? {};
      kta.script.notes = kta.script.notes ?? {};
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsPeriod = (tsClient.periods as unknown[]).find((p) => (p as { id: string }).id === "t1-p-1") as {
        grades(): Promise<unknown[]>; averages(): Promise<unknown[]>; overallAverage(): Promise<unknown>;
        absences(): Promise<unknown[]>; delays(): Promise<unknown[]>; punishments(): Promise<unknown[]>;
      };

      const tsGrades = (await tsPeriod.grades()) as Record<string, unknown>[];
      const ktGrades = JSON.parse(await ask({ op: "periodGrades", cid: ktCid, periodId: "t1-p-1" }));
      expect(canonTs(ktGrades)).toBe(tsCanon(tsGrades.map(flatGrade)));

      const tsAvg = await tsPeriod.averages();
      const ktAvg = JSON.parse(await ask({ op: "periodAverages", cid: ktCid, periodId: "t1-p-1" }));
      // `subject` est une instance plate (pas de cycle) : le canonique suffit.
      expect(canonTs(ktAvg)).toBe(tsCanon(tsAvg));

      const tsOverall = await tsPeriod.overallAverage();
      const ktOverall = JSON.parse(await ask({ op: "periodOverall", cid: ktCid, periodId: "t1-p-1" }));
      expect(canonTs(ktOverall)).toBe(canonTs(tsOverall));

      for (const [op, fn] of [["periodAbsences", "absences"], ["periodDelays", "delays"], ["periodPunishments", "punishments"]] as const) {
        const tsList = await (tsPeriod[fn]());
        const ktList = JSON.parse(await ask({ op, cid: ktCid, periodId: "t1-p-1" }));
        expect(`${op} -> ${canonTs(ktList)}`).toBe(`${op} -> ${tsCanon(tsList)}`);
      }
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("cours : EDT fenêtré, repli fin de cours, contenus + fichiers", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const from = new Date(2026, 8, 20);
      const to = new Date(2026, 8, 27);
      const tsLessons = await tsClient.lessons(from, to);
      const ktLessons = JSON.parse(
        await ask({ op: "lessons", cid: ktCid, from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }),
      );
      // `l-2` (fin absente, repli `ListeHeuresFin`) est dedans. 4 cours, pas 2 :
      // la fenêtre couvre 2 semaines et le stub répond pareil par semaine (en réel
      // chaque semaine a ses cours) — les deux côtés s'accordent sur les 4.
      expect(canonTs(ktLessons)).toBe(tsCanon(tsLessons));
      expect((ktLessons as unknown[]).length).toBe(4);

      // Contenu + fichiers du premier cours.
      const tsContent = await (tsLessons[0] as { content(): Promise<unknown> }).content();
      const ktContent = JSON.parse(
        await ask({ op: "lessonContent", cid: ktCid, lessonId: "t2-l-1", from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }),
      );
      expect(canonTs(ktContent)).toBe(tsCanon(tsContent));

      // Cours sans contenu : `null` des deux côtés.
      const tsEmpty = await (tsLessons[1] as { content(): Promise<unknown> }).content();
      const ktEmpty = JSON.parse(
        await ask({ op: "lessonContent", cid: ktCid, lessonId: "t2-l-2", from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }),
      );
      expect(tsEmpty).toBeNull();
      expect(ktEmpty).toBeNull();
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("devoirs : fenêtre, bascule fait, URL magique + octets", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const from = new Date(2026, 8, 20);
      const to = new Date(2026, 8, 30);
      // `h-2` (2020, fait) est hors fenêtre : un seul devoir.
      const tsHw = await tsClient.homework(from, to);
      const ktHw = JSON.parse(
        await ask({ op: "homework", cid: ktCid, from: "2026-09-20T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" }),
      );
      expect((ktHw as unknown[]).length).toBe(1);
      expect(canonTs(ktHw)).toBe(tsCanon(tsHw));

      // Bascule : le serveur voit le même `SaisieTAFFaitEleve` des deux côtés.
      await (tsHw[0] as { setDone(b: boolean): Promise<void> }).setDone(true);
      const ktDone = JSON.parse(
        await ask({ op: "hwSetDone", cid: ktCid, hwId: "t2-h-1", from: "2026-09-20T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z", done: true }),
      );
      expect(ktDone).toEqual({ done: true });
      const tsToggle = tsa.posts.filter((p) => p.id === "SaisieTAFFaitEleve").map((p) => p.inner);
      const ktToggle = kta.posts.filter((p) => p.id === "SaisieTAFFaitEleve").map((p) => p.inner);
      expect(canonTs(ktToggle)).toBe(canonTs(tsToggle));

      // Pièce jointe : URL magique AES identique (clé de session commune) + octets.
      const tsFiles = await (tsHw[0] as { files(): Array<{ url: string; name: string; data(): Promise<Buffer> }> }).files();
      const ktAtt = JSON.parse(
        await ask({ op: "attachmentProbe", cid: ktCid, from: "2026-09-20T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" }),
      ) as { url: string; dataHex: string; name: string };
      const tsUrl = tsFiles[0]?.url ?? "";
      checkMagic(tsa, tsUrl, "t2-f-2");
      checkMagic(kta, ktAtt.url, "t2-f-2");
      expect(normMagicUrl(ktAtt.url)).toBe(normMagicUrl(tsUrl));
      expect(ktAtt.name).toBe(tsFiles[0]?.name);
      expect(ktAtt.dataHex).toBe((await tsFiles[0]?.data())?.toString("hex"));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("messagerie : liste filtrée, fil chaîné, reply/markAs/delete/participants", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      // `d-2` (pas une discussion) et `d-3` (profondeur 1) filtrées : une seule.
      const tsList = await tsClient.discussions();
      const ktList = JSON.parse(await ask({ op: "discussions", cid: ktCid }));
      expect((ktList as unknown[]).length).toBe(1);
      expect(canonTs(ktList)).toBe(tsCanon(tsList));
      // `onlyUnread` : même filtre ET mêmes objets (`d-1` a `nbNonLus: 2`).
      const tsUnread = await tsClient.discussions(true);
      const ktUnread = JSON.parse(await ask({ op: "discussions", cid: ktCid, onlyUnread: true }));
      expect((ktUnread as unknown[]).length).toBe(1);
      expect(canonTs(ktUnread)).toBe(tsCanon(tsUnread));

      // Fil complet : chaînage `m-2 -> m-1 -> null(m-0 inconnu)`, auteur null si émetteur.
      const tsD = tsList[0] as unknown as {
        messages(): Promise<Record<string, unknown>[]>;
        reply(m: string): Promise<void>; markAs(b: boolean): Promise<void>;
        participants(): Promise<unknown[]>; delete(): Promise<void>; id: string;
      };
      const tsMessages = (await tsD.messages()).map(flatMessage);
      const ktFlow = JSON.parse(await ask({ op: "discussionFlow", cid: ktCid, discussionId: "t2-d-1", text: "Bien reçu" })) as {
        messages: unknown[]; participants: unknown[];
      };
      expect(canonTs(ktFlow.messages)).toBe(tsCanon(tsMessages));
      await tsD.reply("Bien reçu");
      await tsD.markAs(true);
      const tsParts = await tsD.participants();
      await tsD.delete();
      expect(canonTs(ktFlow.participants)).toBe(tsCanon(tsParts));
      // Les écritures vues par le serveur sont identiques (SaisieMessage ×3 + public).
      const sig = (posts: RecordedPost[]) =>
        posts.filter((p) => ["SaisieMessage", "SaisiePublicMessage", "ListeMessages"].includes(p.id)).map((p) => ({ id: p.id, inner: p.inner }));
      expect(canonTs(sig(kta.posts))).toBe(canonTs(sig(tsa.posts)));

      // Destinataires du premier message.
      const tsMsgs = await tsD.messages();
      const tsFirst = tsMsgs[0] as unknown as { recipients(): Promise<unknown[]> };
      const tsRecips = await tsFirst.recipients();
      const ktRecips = JSON.parse(await ask({ op: "messageRecipients", cid: ktCid, discussionId: "t2-d-1", messageId: "t2-m-1" }));
      expect(canonTs(ktRecips)).toBe(tsCanon(tsRecips));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("messagerie : destinataires + nouvelle discussion", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsR = await tsClient.getRecipients();
      const ktR = JSON.parse(await ask({ op: "getRecipients", cid: ktCid }));
      // `teacher` (G=3, fonctions) + `staff` (G=7→staff, `[fonction]`).
      expect(canonTs(ktR)).toBe(tsCanon(tsR));
      // Le prof écrit en premier (G:3 avant G:34), `type`/`functions` portés.
      expect((ktR as Array<{ type: string }>)?.map((r) => r.type)).toEqual(["teacher", "staff"]);

      await tsClient.newDiscussion("Sujet", "Bonjour", [tsR[0] as never]);
      const ktSent = JSON.parse(await ask({ op: "newDiscussion", cid: ktCid, subject: "Sujet", body: "Bonjour", to: ["t2-r-1"] })) as { sent: number };
      expect(ktSent).toEqual({ sent: 1 });
      const payload = (posts: RecordedPost[]) => posts.filter((p) => p.id === "SaisieMessage").map((p) => p.inner);
      expect(canonTs(payload(kta.posts))).toBe(canonTs(payload(tsa.posts)));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("actus : liste, filtres, contenu + pièces jointes", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsNews = await tsClient.informationAndSurveys();
      const ktNews = JSON.parse(await ask({ op: "news", cid: ktCid }));
      expect((ktNews as unknown[]).length).toBe(2);
      expect(canonTs(ktNews)).toBe(tsCanon(tsNews));
      // `onlyUnread` : `n-2` (lue) écartée.
      const tsUnread = await tsClient.informationAndSurveys({ onlyUnread: true });
      const ktUnread = JSON.parse(await ask({ op: "news", cid: ktCid, onlyUnread: true }));
      expect((ktUnread as unknown[]).length).toBe(1);
      expect(canonTs(ktUnread)).toBe(tsCanon(tsUnread));
      // Fenêtre sur `startDate` présent (`n-2` sans `startDate` : écartée).
      const tsWindow = await tsClient.informationAndSurveys({ dateFrom: new Date(2026, 8, 10), dateTo: new Date(2026, 8, 12) });
      const ktWindow = JSON.parse(
        await ask({ op: "news", cid: ktCid, dateFrom: "2026-09-10T00:00:00.000Z", dateTo: "2026-09-12T00:00:00.000Z" }),
      );
      expect((ktWindow as unknown[]).length).toBe(1);
      expect(canonTs(ktWindow)).toBe(tsCanon(tsWindow));

      const tsN = tsNews[0] as { content(): Promise<string>; attachments(): Promise<unknown[]> };
      const ktN = JSON.parse(await ask({ op: "newsContent", cid: ktCid, newsId: "t2-n-1" })) as { content: string; attachments: unknown[] };
      expect(ktN.content).toBe(await tsN.content());
      const normUrlsArr = (j: string): string =>
        j.replace(/\/FichiersExternes\/[0-9A-Fa-f]+\//g, "/FichiersExternes/MAGIC/").replace(/:\d+\//g, ":PORT/");
      expect(normUrlsArr(canonTs(ktN.attachments))).toBe(normUrlsArr(tsCanon(await tsN.attachments())));
      // La pièce jointe a le bon magic des deux côtés.
      const tsAtt = ((await tsN.attachments()) as Array<{ url: string }>)[0];
      if (tsAtt) checkMagic(tsa, tsAtt.url, "t2-f-3");
      const ktAtt = (ktN.attachments as Array<{ url: string }>)[0];
      if (ktAtt) checkMagic(kta, ktAtt.url, "t2-f-3");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("cantine : semaines balayées, plats, `Date` injectée, filtre fenêtre", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsMenus = await tsClient.menus(new Date(2026, 8, 21), new Date(2026, 8, 21));
      const ktMenus = JSON.parse(
        await ask({ op: "menus", cid: ktCid, from: "2026-09-21T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" }),
      );
      expect((ktMenus as unknown[]).length).toBe(3);
      expect(canonTs(ktMenus)).toBe(tsCanon(tsMenus));
      // `G=0` déjeuner, `G=1` dîner, fromage/dessert au bon index (5/4).
      const dinner = (ktMenus as Array<{ isLunch: boolean; isDinner: boolean }>)[1];
      expect(dinner).toMatchObject({ isLunch: false, isDinner: true });
      // `G: null` = déjeuner (`Number(null) == 0`), sans slot (L11).
      const gouter = (ktMenus as Array<{ isLunch: boolean; isDinner: boolean }>)[2];
      expect(gouter).toMatchObject({ isLunch: true, isDinner: false });
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("profil : identité, photo, `cache()` + semaine + creds ENT", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsInfo = tsClient.info as unknown as Record<string, unknown>;
      const ktInfo = JSON.parse(await ask({ op: "clientInfo", cid: ktCid })) as { info: unknown; cache: unknown };
      const tsRendered = {
        info: {
          id: tsInfo.id, name: tsInfo.name, className: (tsInfo as Record<string, unknown>).className,
          establishment: (tsInfo as Record<string, unknown>).establishment,
          delegue: (tsInfo as Record<string, unknown>).delegue,
          profilePicture: (() => {
            const p = (tsInfo as Record<string, { url: string; name: string; id: string; type: number }>).profilePicture;
            return p ? { url: p.url, name: p.name, id: p.id, type: p.type } : null;
          })(),
        },
        cache: await (tsInfo as unknown as { cache(): Promise<unknown> }).cache(),
      };
      // URLs magiques + ports normalisés (IV et stubs par-côté, prouvés par ailleurs).
      const normUrls = (j: string): string =>
        j.replace(/\/FichiersExternes\/[0-9A-Fa-f]+\//g, "/FichiersExternes/MAGIC/").replace(/:\d+\//g, ":PORT/");
      const ktInfoStr = normUrls(canonTs(ktInfo));
      const tsInfoStr = normUrls(tsCanon(tsRendered));
      expect(ktInfoStr).toBe(tsInfoStr);
      // La photo a le bon magic des deux côtés (payload `{N: res-1}`).
      const tsPhoto = ((tsRendered as Record<string, unknown>).info as Record<string, { url: string }>).profilePicture;
      const ktPhoto = (ktInfo as { info: { profilePicture: { url: string } } }).info.profilePicture;
      if (tsPhoto) checkMagic(tsa, tsPhoto.url, "res-1");
      if (ktPhoto) checkMagic(kta, ktPhoto.url, "res-1");

      // `getWeek` : semaine 1 le lundi de `PremierLundi`, avant = négatif (floor, pas troncature).
      for (const iso of ["2026-09-07T00:00:00.000Z", "2026-09-13T00:00:00.000Z", "2026-09-14T00:00:00.000Z", "2026-08-30T00:00:00.000Z"]) {
        const kt = JSON.parse(await ask({ op: "getWeek", cid: ktCid, date: iso })) as { week: number };
        const ts = tsClient.getWeek(new Date(iso));
        expect(`${iso} -> ${kt.week}`).toBe(`${iso} -> ${ts}`);
      }
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("login mot de passe + ENT (branches `sha256` et cookies)", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      // ENT : `e`/`f` lus dans la page (`htmlExtra`), `pourENT: true`, clé
      // `md5(sha256(pass))` — `uuidAppliMobile` reste vide (pas mobile).
      for (const stub of [tsa, kta]) {
        stub.htmlExtra = `e: 'entuser', f: 'entpass'`;
        stub.password = "entpass";
        stub.script.securisation = 0;
      }
      const entTs = async () => {
        const { CookieJar } = await import("tough-cookie");
        return new CookieJar();
      };
      const { Client: C } = await import("pronotets");
      const tsClient = await C.login(`${tsa.base}/pronote/eleve.html`, "nimporte", "entpass", { ent: entTs as never });
      const ktCid = Number(
        JSON.parse(await ask({ op: "clientLogin", site: `${kta.base}/pronote/eleve.html`, username: "nimporte", password: "entpass", ent: true })).cid,
      );
      // `identifiant` vient de la page (`entuser`), pas des arguments.
      const tsIdent = tsa.posts.find((p) => p.id === "Identification");
      const ktIdent = kta.posts.find((p) => p.id === "Identification");
      expect((ktIdent?.inner as { data: Record<string, unknown> }).data).toEqual(
        (tsIdent?.inner as { data: Record<string, unknown> }).data,
      );
      expect(((tsIdent?.inner as { data: Record<string, unknown> }).data as Record<string, unknown>).pourENT).toBe(true);
      const ktState = JSON.parse(await ask({ op: "clientState", cid: ktCid }));
      expect(canonTs(ktState)).toBe(canonTs(tsStateOf(tsClient)));
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("robustesse : enveloppes tordues jettent des deux côtés", async () => {
    const tsa = startStub();
    const kta = startStub();
    try {
      richScript(tsa.script);
      richScript(kta.script);
      // Menu sans `ListePlats` : les deux jettent (pas de cantine silencieuse).
      tsa.script.menus = [{ Date: { V: "21/09/2026" }, ListeRepas: { V: [{ N: "x", L: "X", G: 0 }] } }];
      kta.script.menus = [{ Date: { V: "21/09/2026" }, ListeRepas: { V: [{ N: "x", L: "X", G: 0 }] } }];
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      let tsName = "";
      try {
        await tsClient.menus(new Date(2026, 8, 21), new Date(2026, 8, 21));
      } catch (e) {
        tsName = (e as Error).name;
      }
      const ktErr = portError(
        await ask({ op: "menus", cid: ktCid, from: "2026-09-21T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" }, true),
      );
      // `json.ListePlats.V` absent : accès direct = `TypeError` côté TS,
      // `ParsingError` ciblé côté port. Les deux jettent, aucun ne devine.
      expect(tsName).toBe("TypeError");
      expect(ktErr.name).toBe("ParsingError");
    } finally {
      tsa.close();
      kta.close();
    }
  });

  test.skipIf(skip)("fil chiffré + compressé : `CrA` et `CoA` ensemble", async () => {
    // Régression : #200 n'a prouvé les drapeaux que séparément. Ici les deux :
    // requêtes double-hex chiffrées, réponses simple-hex chiffrées.
    const tsa = startStub();
    const kta = startStub();
    try {
      tsa.coa = true;
      kta.coa = true;
      richScript(tsa.script);
      richScript(kta.script);
      const tsClient = await tsLogin(tsa);
      const ktCid = await ktLogin(kta);
      const tsPeriod = ((tsClient.periods as unknown[]).find((p) => (p as { id: string }).id === "t1-p-1") as {
        grades(): Promise<unknown[]>;
      });
      const tsGrades = (await tsPeriod.grades()) as Record<string, unknown>[];
      const ktGrades = JSON.parse(await ask({ op: "periodGrades", cid: ktCid, periodId: "t1-p-1" }));
      expect(canonTs(ktGrades)).toBe(tsCanon(tsGrades.map(flatGrade)));
      // Le fil brut diffère (flux `deflate` Java ≠ zlib) : on compare les inners
      // déjà décodés par le stub (le décodage double-hex réussi EST la preuve).
      const normInner = (posts: RecordedPost[]) =>
        posts.map((p) => {
          const inner = JSON.parse(JSON.stringify(p.inner)) as { data?: Record<string, unknown> };
          const data = inner.data;
          if (data !== null && typeof data === "object") {
            if ("Uuid" in data) data.Uuid = "TEMP";
            if ("challenge" in data) data.challenge = "#";
            if ("codePin" in data) data.codePin = "#";
          }
          return { id: p.id, inner };
        });
      expect(canonTs(normInner(kta.posts))).toBe(canonTs(normInner(tsa.posts)));
    } finally {
      tsa.close();
      kta.close();
    }
  });
});

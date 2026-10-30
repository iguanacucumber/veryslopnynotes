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

import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { join } from "node:path";

import { ROOT, canonTs, parityToolchain, type ParityLink } from "./kotlin-harness";

export const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "ClientParityMain.kt");

export const skip = parityToolchain.skipReason !== null;

export let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

export async function ask(op: unknown, allowError = false): Promise<string> {
  return link!.ask(op, { allowError });
}

export function portError(line: string): { name: string; message: string } {
  const body = JSON.parse(line) as { error: string; message: string };
  return { name: body.error, message: body.message };
}

export async function tsErrorOfAsync(fn: () => Promise<unknown>): Promise<{ name: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return { name: (e as Error).name, message: (e as Error).message };
  }
}

// --- Constantes du scénario ---------------------------------------------------

export const PIN = "1234";
export const LOGIN = "eleve.dupont";
export const JETON = "jeton-secret-xyz";
export const UUID = "uuid-test-01";
export const TEMP_HEX = "00112233445566778899aabbccddeeff";
export const K0_HEX = createHash("md5").update(Buffer.alloc(0)).digest("hex");
export const IV1_HEX = createHash("md5").update(Buffer.from(TEMP_HEX, "hex")).digest("hex");
export const CLE_PLAIN = "10,20,30";
export const ZEROS = "00000000000000000000000000000000";

export function aes(keyHex: string, ivHex: string, data: Buffer, mode: "enc" | "dec"): Buffer {
  const c = mode === "enc" ? createCipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"))
    : createDecipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
  return Buffer.concat([c.update(data), c.final()]);
}

export function qrHex(pin: string, text: string): string {
  const key = createHash("md5").update(Buffer.from(pin, "utf8")).digest();
  const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  return Buffer.concat([c.update(Buffer.from(text, "utf8")), c.final()]).toString("hex");
}

// --- Comparateurs ---------------------------------------------------------------

/** `Date` → millis, `_clés` et `undefined` omis — AVANT `stringify`
 * (`toJSON` s'appliquerait d'abord et masquerait les `Date` au replacer). */
export function deepTs(v: unknown): unknown {
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

export function tsCanon(v: unknown): string {
  return canonTs(deepTs(v));
}

// --- Stub PRONOTE scripté -------------------------------------------------------

export interface RecordedPost {
  id: string;
  inner: unknown;
  raw: string;
}

export interface StubScript {
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
  /** Session MORTE : chaque POST répond l'erreur « session expirée » (#408). */
  deadSession?: boolean;
  /**
   * Session morte JUSQU'AU prochain handshake (#405) : l'établissement a fermé
   * la session, le refresh (nouveau handshake) la rouvre. Tout post échoue
   * tant qu'aucun handshake n'a eu lieu depuis l'armement.
   */
  deadUntilHandshake?: boolean;
}

export interface Stub {
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

export function defaultScript(): StubScript {
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
export function k1Of(clePlain: string): string {
  return createHash("md5").update(Buffer.from(clePlain.split(",").map((x) => Number(x)))).digest("hex");
}

export function startStub(): Stub {
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
          // Session MORTE (#408) : CHAQUE POST répond l'erreur « session
          // expirée » — le rejeu après `refresh` échoue donc aussi (c'est le
          // cas réel : l'établissement a fermé la session).
          if (s.deadSession) {
            return Response.json({ Erreur: { G: 10, Titre: "session expirée" } });
          }
          // Session morte JUSQU'AU nouveau handshake (#405) : `gets` compte les
          // handshakes (le GET de la page) — le refresh en fait UN de plus, et
          // la session redevient vivante. C'est le cas réel : l'établissement
          // ferme la session, la re-poignée de main la rouvre.
          if (s.deadUntilHandshake && stub.gets < 2) {
            return Response.json({ Erreur: { G: 10, Titre: "session expirée" } });
          }
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

export function answerFor(stub: Stub, id: string, inner: unknown, reqIv: string): unknown {
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

// Clé de challenge : md5(uname + HEXMAJ(sha256(alea + pwd))).
export function ekeyOf(uname: string, pwd: string, alea: string): string {
  const mot = createHash("sha256").update(alea + pwd, "utf8").digest("hex").toUpperCase();
  return createHash("md5").update(Buffer.from(uname + mot, "utf8")).digest("hex");
}

import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { Client } from "pronotets";
import { canonTs } from "./kotlin-harness";
import {
  ask, aes, k1Of, qrHex, ekeyOf, PIN, LOGIN, JETON, UUID, TEMP_HEX, K0_HEX, ZEROS, CLE_PLAIN,
  type Stub, type StubScript, type RecordedPost,
} from "./pronote-client-stub";

// --- Clients des deux côtés -----------------------------------------------------

export async function tsLogin(stub: Stub, opts?: { skip2fa?: boolean; accountPin?: string; deviceName?: string }): Promise<InstanceType<typeof Client>> {
  const { Client: C } = await import("pronotets");
  const qr = { login: qrHex(PIN, LOGIN), jeton: qrHex(PIN, JETON), url: `${stub.base}/pronote/eleve.html` };
  return (await C.qrcodeLogin(qr as never, PIN, UUID, opts ?? {})) as InstanceType<typeof Client>;
}

export async function ktLogin(stub: Stub, opts?: { skip2fa?: boolean; accountPin?: string; deviceName?: string }): Promise<number> {
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

export interface BothCtx {
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
export function normWire(stub: Stub, posts: RecordedPost[]): unknown[] {
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

export function tsStateOf(client: InstanceType<typeof Client>): Record<string, unknown> {
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

export async function expectBothStates(ctx: BothCtx, label: string): Promise<void> {
  const kt = JSON.parse(await ask({ op: "clientState", cid: ctx.ktCid }));
  expect(`${label} state -> ${canonTs(kt)}`).toBe(`${label} state -> ${canonTs(tsStateOf(ctx.tsClient))}`);
}

export async function expectBothWire(ctx: BothCtx, label: string): Promise<void> {
  const ts = canonTs(normWire(ctx.tsa, ctx.tsPosts));
  const kt = canonTs(normWire(ctx.kta, ctx.ktPosts));
  expect(`${label} FIL (ts vs kt):\n${kt}`).toBe(`${label} FIL (ts vs kt):\n${ts}`);
}

// --- Fixtures riches --------------------------------------------------------------

export function richScript(s: StubScript): void {
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

export function normMagicUrl(url: string): string {
  // Magic (IV par-côté) + port (stubs séparés) normalisés : le reste est exact.
  return url
    .replace(/\/FichiersExternes\/[0-9A-Fa-f]+\//, "/FichiersExternes/MAGIC/")
    .replace(/:\d+\//, ":PORT/");
}

export function checkMagic(stub: Stub, url: string, fileId: string): void {
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

export function flatGrade(g: Record<string, unknown>): Record<string, unknown> {
  const { period, ...rest } = g;
  return { ...rest, periodId: (period as { id?: string } | undefined)?.id };
}

export function flatMessage(m: Record<string, unknown>): Record<string, unknown> {
  // `replyingTo` -> id (cycles coupés comme le pilote) ; `date` GARDÉE des deux
  // côtés (le pilote la rend : une régression `dateParse` casserait ici, C7).
  const { replyingTo, ...rest } = m;
  return { ...rest, replyingTo: ((replyingTo as { id?: string } | null)?.id ?? null) as unknown };
}

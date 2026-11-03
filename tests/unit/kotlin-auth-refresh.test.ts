// Politique de re-authentification : SEULS 401 et G=10 rouvrent la session.
// Un 5xx ou un G inconnu laisse la session en place (l'appelant backoff), et
// une écriture non idempotente n'est JAMAIS rejouée. Le vrai `sendWithRefresh`
// est EXÉCUTÉ par le pilote ; outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "RateLimitParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface PolicyResult {
  sends: number;
  refreshes: number;
  replayed: boolean;
  sessionFailure: boolean;
  error: string | null;
}

async function policy(kind: string, fn = "DernieresNotes"): Promise<PolicyResult> {
  return JSON.parse(await link!.ask({ op: "policy", kind, function: fn })) as PolicyResult;
}

const AUTH_ERRORS = ["http401", "g10"];
// #874 : les lectures idempotentes réessaient un 5xx sans login.
const TRANSIENT_ERRORS = ["http500", "http503"];
const OTHER_ERRORS = ["http403", "g99"];

describe("refresh seulement sur un refus d'authentification", () => {
  test.skipIf(skip)("401 et G=10 : UN refresh puis UN rejeu de la lecture", async () => {
    for (const kind of AUTH_ERRORS) {
      expect({ kind, ...(await policy(kind)) }).toEqual({
        kind,
        sends: 2,
        refreshes: 1,
        replayed: true,
        sessionFailure: true,
        error: null,
      });
    }
  });

  test.skipIf(skip)("5xx : réessai de la lecture, AUCUN login", async () => {
    for (const kind of TRANSIENT_ERRORS) {
      expect({ kind, ...(await policy(kind)) }).toEqual({
        kind,
        sends: 2,
        refreshes: 0,
        replayed: true,
        sessionFailure: false,
        error: null,
      });
    }
  });

  test.skipIf(skip)("403 et G inconnu : aucun login, erreur immédiate", async () => {
    for (const kind of OTHER_ERRORS) {
      expect({ kind, ...(await policy(kind)) }).toEqual({
        kind,
        sends: 1,
        refreshes: 0,
        replayed: false,
        sessionFailure: false,
        error: "PronoteAPIError",
      });
    }
  });

  test.skipIf(skip)("G=22 et G=25 ne rouvrent pas la session", async () => {
    expect(await policy("g22")).toMatchObject({
      sends: 1,
      refreshes: 0,
      replayed: false,
      sessionFailure: false,
      error: "ExpiredObject",
    });
    expect(await policy("g25")).toMatchObject({
      sends: 1,
      refreshes: 0,
      replayed: false,
      sessionFailure: false,
      error: "RateLimitedError",
    });
  });

  test.skipIf(skip)("écriture non idempotente : JAMAIS de rejeu, même sur 401/G=10", async () => {
    for (const fn of ["SaisieMessage", "SaisieTAFFaitEleve", "SecurisationCompteDoubleAuth"]) {
      for (const kind of AUTH_ERRORS) {
        const r = await policy(kind, fn);
        // Une seule requête : un doublon enverrait deux fois le message.
        expect({ fn, kind, ...r }).toEqual({
          fn,
          kind,
          sends: 1,
          refreshes: 0,
          replayed: false,
          sessionFailure: true,
          error: "PronoteAPIError",
        });
      }
      // Un 5xx n'autorise pas davantage de rejeu ni de login.
      expect({ fn, ...(await policy("http500", fn)) }).toMatchObject({
        fn,
        sends: 1,
        refreshes: 0,
        replayed: false,
        sessionFailure: false,
      });
    }
  });

  test.skipIf(skip)("la poignée de main ne se rejoue pas hors de son contexte", async () => {
    for (const fn of ["Identification", "Authentification", "ParametresUtilisateur"]) {
      expect({ fn, ...(await policy("g10", fn)) }).toMatchObject({
        fn,
        sends: 1,
        refreshes: 0,
        replayed: false,
        sessionFailure: true,
        error: "PronoteAPIError",
      });
    }
  });
});

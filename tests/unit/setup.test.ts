// POST /v1/setup (#118) — le flux « tout marche » : compte école + jeton de
// device en UN appel. Fakes 100 % synthétiques, aucun accès réseau : le
// provider est injecté, c'est lui qui « ouvre la session ».
// On vérifie ici ce qui change VRAIMENT le métier : la résolution QR vs
// identifiants, l'unicité du jeton, les refus ACTIONNABLES (jamais 401), et
// les garde-fou réseau de la route ouverte.
import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { PairingService } from "../../server/api/pairing";
import { SetupService, SetupThrottle, isPublicSchoolUrl, sameSchool } from "../../server/api/setup";
import { createMemoryStore } from "../../server/api/store";
import { PronoteAuthError } from "../../server/domain/ports";
import { isApiErrorBody } from "../../server/api/errors";
import { isSetupRequest, isSetupResponse } from "../../shared/contracts/api";
import type { SetupRequest } from "../../shared/contracts/api";
import type { Device } from "../../shared/contracts/models";
import type { PronoteCredentials, PronoteSession } from "../../server/domain/ports";

/** Provider fake : enregistre ce qu'il reçoit, échoue sur commande. */
function provider(behaviour: "ok" | "fail" = "ok", code: "invalid_credentials" | "qr_rejected" | "network" | "timeout" = "invalid_credentials") {
  const calls: PronoteCredentials[] = [];
  let opened = false;
  return {
    calls,
    isOpen: () => opened,
    sessions: {
      async authenticate(credentials: PronoteCredentials): Promise<PronoteSession> {
        calls.push(credentials);
        if (behaviour === "fail") throw new PronoteAuthError("refus", code);
        opened = true;
        return { accountId: credentials.accountId };
      },
    } as never,
  };
}

const PARAYED_DEVICE = (): Device => ({ id: "dev-1", tokenHash: "a".repeat(64) });

function service(sessions: unknown, opts: Record<string, unknown> = {}) {
  let devices = 0;
  let secrets = 0;
  // Un jeton (et un device) distinct par émission : c'est ce qui permet de
  // vérifier qu'aucun secret n'est re-servi, juste ré-émis.
  const pairing = new PairingService({
    uuid: () => `dev-${(devices += 1)}`,
    token: () => `secret-device-token-${(secrets += 1)}`,
  });
  const opened: { accountId: string; credentials: PronoteCredentials }[] = [];
  const logs: string[] = [];
  const setup = new SetupService({
    sessions: sessions as never,
    issue: () => pairing.issue(),
    onOpened: (accountId, credentials) => opened.push({ accountId, credentials }),
    logger: (m) => logs.push(m),
    ...opts,
  });
  return { setup, pairing, opened, logs, handler: createHandler(createMemoryStore(), pairing, null, undefined, undefined, null, null, null, null, setup) };
}

const CREDENTIALS: SetupRequest = {
  deviceName: "pixel",
  schoolUrl: "https://etablissement.index-education.net/pronote",
  ent: "ninegate",
  username: "eleve",
  password: "motdepasse",
};

const QR: SetupRequest = {
  deviceName: "pixel",
  schoolUrl: "https://etablissement.index-education.net/pronote",
  ent: "ninegate",
  qr: { login: "a1b2c3", jeton: "d4e5f6", url: "https://etablissement.index-education.net/pronote" },
  pin: "1234",
};

async function post(handler: (req: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request("http://127.0.0.1/v1/setup", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
  );
}

describe("POST /v1/setup — compte école puis jeton", () => {
  test("identifiants ENT → session ouverte + jeton UNE SEULE FOIS", async () => {
    const p = provider();
    const { setup, opened, handler } = service(p.sessions);
    const res = await post(handler, CREDENTIALS);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(isSetupResponse(payload)).toBe(true);
    const body = payload as { device: Device; token: string };
    // Le secret est bien celui du serveur, et le device existe côté PairingService.
    expect(body.token).toBe("secret-device-token-1");
    expect(p.calls[0]?.username).toBe("eleve");
    expect(p.calls[0]?.pronoteUrl).toBe(CREDENTIALS.schoolUrl);
    expect(opened).toHaveLength(1);
    // Un 2e setup RÉ-ÉMET un credential (nouveau device, nouveau secret) : il ne
    // re-sert jamais le même token, et le 1er device reste valable en parallèle.
    const again = (await (await post(handler, CREDENTIALS)).json()) as { device: Device; token: string };
    expect(again.token).toBe("secret-device-token-2");
    expect(again.device.id).not.toBe(body.device.id);
    const lecture = await handler(new Request("http://127.0.0.1/v1/grades", { headers: { authorization: `Bearer ${body.token}` } }));
    expect(lecture.status).toBe(200);
  });

  test("QR de l'établissement → mode qrcodeLogin (login+jeton+Pin, pas de mot de passe)", async () => {
    const p = provider();
    const { setup, handler } = service(p.sessions);
    const res = await post(handler, QR);
    expect(res.status).toBe(200);
    const creds = p.calls[0];
    expect(creds?.qr).toEqual(QR.qr);
    expect(creds?.pin).toBe("1234");
    // Jamais de mot de passe traversé en mode QR.
    expect(creds?.password).toBe("");
    expect(creds?.username).toBe("");
  });

  test("QR ET identifiants fournis → le QR prime (deux sessions exclusives)", async () => {
    const p = provider();
    const { handler } = service(p.sessions);
    const res = await post(handler, { ...CREDENTIALS, ...QR, qr: QR.qr, pin: QR.pin });
    expect(res.status).toBe(200);
    expect(p.calls[0]?.qr).toBeDefined();
    expect(p.calls[0]?.password).toBe("");
  });

  test("session déjà ouverte par l'env → jeton rendu SANS rejouer une connexion", async () => {
    const p = provider();
    const { opened, handler } = service(p.sessions, { existingAccountId: () => "acc-deja-ouvert" });
    const res = await post(handler, CREDENTIALS);
    expect(res.status).toBe(200);
    expect(p.calls).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });

  test("sans provider → 501 honnête, jamais un jeton ni un 200 mensonger", async () => {
    const { handler } = service(null);
    const res = await post(handler, CREDENTIALS);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      error: { code: "not_implemented", message: "setup non branche (aucune session Pronote)" },
    });
  });
});

describe("POST /v1/setup — refus actionnables (jamais 401)", () => {
  const cases: readonly {
    readonly failure: "invalid_credentials" | "qr_rejected" | "network" | "timeout";
    readonly status: number;
    readonly api: string;
  }[] = [
    { failure: "invalid_credentials", status: 400, api: "login_refused" },
    { failure: "qr_rejected", status: 400, api: "qr_rejected" },
    { failure: "network", status: 502, api: "ent_unreachable" },
    { failure: "timeout", status: 502, api: "ent_unreachable" },
  ];
  for (const { failure, status, api } of cases) {
    test(`PronoteAuthError ${failure} → ${status} ${api}`, async () => {
      const { handler } = service(provider("fail", failure).sessions);
      const res = await post(handler, CREDENTIALS);
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(isApiErrorBody(body)).toBe(true);
      expect((body as { error: { code: string } }).error.code).toBe(api);
      // Un 401 déconnecterait l'app alors que c'est la saisie qui est refusée.
      expect(res.headers.get("www-authenticate")).toBeNull();
    });
  }

  test("corps incomplet → 400, et le jeton n'apparaît nulle part", async () => {
    const { handler } = service(provider().sessions);
    for (const body of ["{}", "", "[]", '{"deviceName":"pixel"}', JSON.stringify({ ...QR, pin: undefined })]) {
      const res = await post(handler, body);
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain("token");
    }
  });
});

describe("POST /v1/setup — garde-fou réseau (route ouverte)", () => {
  test("URL d'établissement privée ou locale → refus AVANT toute sortie", async () => {
    for (const url of ["http://10.0.0.1/pronote", "http://127.0.0.1:3000", "http://169.254.169.254/", "http://192.168.1.5", "http://localhost/pronote", "http://[::1]/", "ftp://exemple.fr"]) {
      const p = provider();
      const { handler } = service(p.sessions);
      const res = await post(handler, { ...CREDENTIALS, schoolUrl: url });
      expect(res.status).toBe(400);
      expect(p.calls).toHaveLength(0);
    }
  });

  test("URL publique → acceptée par le filtre littéral", () => {
    expect(isPublicSchoolUrl("https://etablissement.index-education.net/pronote")).toBe(true);
    expect(isPublicSchoolUrl("https://192.0.2.10/pronote")).toBe(true);
    expect(isPublicSchoolUrl("pas une url")).toBe(false);
    expect(isPublicSchoolUrl("https://172.16.0.1/")).toBe(false);
    expect(isPublicSchoolUrl("http://foo.localhost/")).toBe(false);
  });

  test("PRONOTE_URL épinglée → le setup ne peut pas viser une autre école", async () => {
    const p = provider();
    const { handler } = service(p.sessions, { allowedSchoolUrl: "https://etablissement.index-education.net/pronote" });
    const autre = await post(handler, { ...CREDENTIALS, schoolUrl: "https://autre-etablissement.fr/pronote" });
    expect(autre.status).toBe(400);
    expect(p.calls).toHaveLength(0);
    // Même école, barre finale en plus : accepté.
    const meme = await post(handler, { ...CREDENTIALS, schoolUrl: "https://etablissement.index-education.net/pronote/" });
    expect(meme.status).toBe(200);
    expect(sameSchool("https://a.fr/pronote/", "https://a.fr/pronote")).toBe(true);
    expect(sameSchool("https://a.fr/pronote", "http://a.fr/pronote")).toBe(false);
  });

  test("trop d'échecs → 429 avant de toucher l'ENT (pas de boucle hors ligne)", async () => {
    const p = provider("fail");
    let now = 0;
    const throttle = new SetupThrottle(2, 60_000, () => now);
    const { handler } = service(p.sessions, { throttle });
    expect((await post(handler, CREDENTIALS)).status).toBe(400);
    expect((await post(handler, CREDENTIALS)).status).toBe(400);
    const tentatives = p.calls.length;
    const bloque = await post(handler, CREDENTIALS);
    expect(bloque.status).toBe(429);
    expect(await bloque.json()).toEqual({
      error: { code: "rate_limited", message: "trop de tentatives, reessayez plus tard" },
    });
    expect(p.calls).toHaveLength(tentatives);
    // Fenêtre écoulée : l'utilisateur peut réessayer (le blocage n'est pas définitif).
    now = 60_001;
    expect((await post(handler, CREDENTIALS)).status).toBe(400);
  });

  test("un setup RÉUSSI ne consomme pas de budget d'échecs", async () => {
    const ok = provider();
    const throttle = new SetupThrottle(2, 60_000, () => 0);
    const { handler: bon } = service(ok.sessions, { throttle });
    for (let i = 0; i < 5; i += 1) expect((await post(bon, CREDENTIALS)).status).toBe(200);
    expect(throttle.blocked()).toBe(false);
  });
});

describe("contrat POST /v1/setup", () => {
  test("le garde-fou exige au moins une méthode COMPLÈTE", () => {
    expect(isSetupRequest(CREDENTIALS)).toBe(true);
    expect(isSetupRequest(QR)).toBe(true);
    // Ni QR ni identifiants : rien à tenter, refus sans consommer d'ENT.
    expect(isSetupRequest({ deviceName: "p", schoolUrl: "https://a.fr", ent: "ninegate" })).toBe(false);
    // Méthodes incomplètes : refus aussi (pas de login à moitié fait).
    expect(isSetupRequest({ ...CREDENTIALS, password: undefined })).toBe(false);
    expect(isSetupRequest({ ...QR, pin: undefined })).toBe(false);
    expect(isSetupRequest({ ...QR, qr: { login: "aa" } as never })).toBe(false);
    // Bornes : rien d'énorme n'entre.
    expect(isSetupRequest({ ...CREDENTIALS, username: "x".repeat(257) })).toBe(false);
    expect(isSetupRequest({ ...CREDENTIALS, schoolUrl: "https://a.fr/" + "x".repeat(300) })).toBe(false);
    expect(isSetupRequest({ ...QR, qr: { login: "x".repeat(1025), jeton: "aa" } })).toBe(false);
  });

  test("le secret du device sort en entier une seule fois", () => {
    expect(isSetupResponse({ device: PARAYED_DEVICE(), token: "t" })).toBe(true);
    expect(isSetupResponse({ device: PARAYED_DEVICE() })).toBe(false);
    expect(isSetupResponse({ token: "t" })).toBe(false);
  });
});
// POST /v1/setup (#118) — le flux « tout marche » : compte école + jeton de
// device en UN appel. Fakes 100 % synthétiques, aucun accès réseau : le
// provider est injecté, c'est lui qui « ouvre la session ».
// 0.7.0 : le QR + son pin sont la MÉTHODE UNIQUE (aucun identifiant, aucun
// credential serveur). On vérifie ici ce qui change VRAIMENT le métier :
// l'unicité du jeton, les refus ACTIONNABLES (jamais 401), et le garde-fou
// réseau de la route ouverte.
import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { PairingService } from "../../server/api/pairing";
import { SetupService, SetupThrottle, isPublicSchoolUrl } from "../../server/api/setup";
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

const QR: SetupRequest = {
  deviceName: "pixel",
  schoolUrl: "https://etablissement.index-education.net/pronote",
  qr: { login: "a1b2c3", jeton: "d4e5f6", url: "https://etablissement.index-education.net/pronote" },
  pin: "1234",
};

async function post(handler: (req: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request("http://127.0.0.1/v1/setup", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
  );
}

describe("POST /v1/setup — compte école puis jeton", () => {
  test("identifiants Pronote → session ouverte + jeton UNE SEULE FOIS", async () => {
    const p = provider();
    const { setup, opened, handler } = service(p.sessions);
    const res = await post(handler, QR);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(isSetupResponse(payload)).toBe(true);
    const body = payload as { device: Device; token: string };
    // Le secret est bien celui du serveur, et le device existe côté PairingService.
    expect(body.token).toBe("secret-device-token-1");
    expect(p.calls[0]?.qr).toEqual(QR.qr);
    expect(p.calls[0]?.pronoteUrl).toBe(QR.schoolUrl);
    expect(opened).toHaveLength(1);
    // Un 2e setup RÉ-ÉMET un credential (nouveau device, nouveau secret) : il ne
    // re-sert jamais le même token, et le 1er device reste valable en parallèle.
    const again = (await (await post(handler, QR)).json()) as { device: Device; token: string };
    expect(again.token).toBe("secret-device-token-2");
    expect(again.device.id).not.toBe(body.device.id);
    const lecture = await handler(new Request("http://127.0.0.1/v1/grades", { headers: { authorization: `Bearer ${body.token}` } }));
    expect(lecture.status).toBe(200);
  });

  test("QR de l'établissement → qrcodeLogin (login+jeton+pin), tel quel", async () => {
    const p = provider();
    const { setup, handler } = service(p.sessions);
    const res = await post(handler, QR);
    expect(res.status).toBe(200);
    // Le credential traverse TEL QUEL, sans transformation ni reconstruction.
    expect(p.calls[0]?.qr).toEqual(QR.qr);
    expect(p.calls[0]?.pin).toBe("1234");
    expect(p.calls[0]?.pronoteUrl).toBe(QR.schoolUrl);
  });

  test("setup rejoué → jeton rendu SANS rouvrir une connexion (mono-compte)", async () => {
    const p = provider();
    const { opened, handler } = service(p.sessions, { existingAccountId: () => "acc-deja-ouvert" });
    const res = await post(handler, QR);
    expect(res.status).toBe(200);
    expect(p.calls).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });

  test("sans provider → 501 honnête, jamais un jeton ni un 200 mensonger", async () => {
    const { handler } = service(null);
    const res = await post(handler, QR);
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
    { failure: "network", status: 502, api: "school_unreachable" },
    { failure: "timeout", status: 502, api: "school_unreachable" },
  ];
  for (const { failure, status, api } of cases) {
    test(`PronoteAuthError ${failure} → ${status} ${api}`, async () => {
      const { handler } = service(provider("fail", failure).sessions);
      const res = await post(handler, QR);
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
      const res = await post(handler, { ...QR, schoolUrl: url });
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

  test("URL du QR non publique → refus AVANT toute sortie", async () => {
    const p = provider();
    const { handler } = service(p.sessions);
    const res = await post(handler, {
      ...QR,
      qr: { ...QR.qr, url: "http://169.254.169.254/" },
    });
    expect(res.status).toBe(400);
    expect(p.calls).toHaveLength(0);
  });

  test("trop d'échecs → 429 avant de toucher l'établissement (pas de boucle hors ligne)", async () => {
    const p = provider("fail");
    let now = 0;
    const throttle = new SetupThrottle(2, 60_000, () => now);
    const { handler } = service(p.sessions, { throttle });
    expect((await post(handler, QR)).status).toBe(400);
    expect((await post(handler, QR)).status).toBe(400);
    const tentatives = p.calls.length;
    const bloque = await post(handler, QR);
    expect(bloque.status).toBe(429);
    expect(await bloque.json()).toEqual({
      error: { code: "rate_limited", message: "trop de tentatives, reessayez plus tard" },
    });
    expect(p.calls).toHaveLength(tentatives);
    // Fenêtre écoulée : l'utilisateur peut réessayer (le blocage n'est pas définitif).
    now = 60_001;
    expect((await post(handler, QR)).status).toBe(400);
  });

  test("un setup RÉUSSI ne consomme pas de budget d'échecs", async () => {
    const ok = provider();
    const throttle = new SetupThrottle(2, 60_000, () => 0);
    const { handler: bon } = service(ok.sessions, { throttle });
    for (let i = 0; i < 5; i += 1) expect((await post(bon, QR)).status).toBe(200);
    expect(throttle.blocked()).toBe(false);
  });
});

describe("contrat POST /v1/setup", () => {
  test("le garde-fou exige le trio deviceName + schoolUrl + QR + pin", () => {
    expect(isSetupRequest(QR)).toBe(true);
    // Rien d'exploitable : refus sans consommer d'établissement.
    expect(isSetupRequest({ deviceName: "p", schoolUrl: "https://a.fr" })).toBe(false);
    // Incomplet : refus aussi (pas de connexion à moitié faite).
    expect(isSetupRequest({ ...QR, pin: undefined })).toBe(false);
    expect(isSetupRequest({ ...QR, qr: { login: "aa" } as never })).toBe(false);
    // Bornes : rien d'énorme n'entre.
    expect(isSetupRequest({ ...QR, pin: "x".repeat(65) })).toBe(false);
    expect(isSetupRequest({ ...QR, qr: { login: "a", jeton: "b".repeat(1025) } })).toBe(false);
    expect(isSetupRequest({ ...QR, schoolUrl: "https://a.fr/" + "x".repeat(300) })).toBe(false);
    expect(isSetupRequest({ ...QR, qr: { login: "x".repeat(1025), jeton: "aa" } })).toBe(false);
  });

  test("0.7.0 : plus de méthode « identifiants » — des identifiants seuls sont refusés", () => {
    // Le contrat n'a qu'une méthode (QR + pin). Une app 0.6.0 qui envoie des
    // identifiants SANS QR n'a plus rien d'exploitable : refus net, 400.
    const sansQr = { deviceName: "pixel", schoolUrl: QR.schoolUrl, username: "eleve", password: "mdp" };
    expect(isSetupRequest(sansQr)).toBe(false);
  });

  test("le secret du device sort en entier une seule fois", () => {
    expect(isSetupResponse({ device: PARAYED_DEVICE(), token: "t" })).toBe(true);
    expect(isSetupResponse({ device: PARAYED_DEVICE() })).toBe(false);
    expect(isSetupResponse({ token: "t" })).toBe(false);
  });
});